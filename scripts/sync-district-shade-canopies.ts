import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDongguSmartShadeClient,
  createSuseongShadeClient,
  type DistrictShadeFacility,
} from "../src/integrations/heat-relief/district-shade.server.ts";
import {
  createNaverGeocoder,
  type NaverGeocoder,
} from "../src/integrations/naver/geocode.server.ts";
import type { OfficialShadeCanopy } from "../src/lib/heat-relief/shade-canopy-csv.ts";

const OUTPUT_PATH = "data/heat-relief/api/district-shade-canopies.json";
const CACHE_PATH = "data/heat-relief/api/geocode-cache.json";

interface GeocodeResult {
  readonly latitude: number;
  readonly longitude: number;
  readonly provider: "NAVER";
}

type GeocodeCache = Record<string, GeocodeResult>;

function normalizedAddress(value: string): string {
  return value
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

async function readCache(path: string): Promise<GeocodeCache> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as GeocodeCache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

async function geocodeAddress(
  address: string,
  district: string,
  providers: Readonly<{
    naver: NaverGeocoder | null;
  }>,
): Promise<GeocodeResult | null> {
  if (providers.naver) {
    const queries = [address, address.replace(/(대로|로|길)\s+지하(?=\d)/u, "$1 ")];
    for (const query of new Set(queries)) {
      try {
        const candidate = (await providers.naver.search(query)).find(({ gu }) => gu === district);
        if (candidate) {
          return {
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            provider: "NAVER",
          };
        }
      } catch {
        // The unresolved address is reported in the audit instead of guessed.
      }
    }
  }
  return null;
}

function toOfficialCanopy(
  facility: DistrictShadeFacility,
  coordinate: GeocodeResult,
): OfficialShadeCanopy {
  const detail = [facility.administrativeDong, facility.detail]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  return {
    sourceFeatureId: facility.sourceId,
    source: facility.source,
    name: facility.name,
    city: "대구광역시",
    district: facility.district,
    roadAddress: facility.address,
    lotAddress: null,
    coordinate: {
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    },
    facilityType: facility.source === "DONGGU_SMART_SHADE_API" ? "스마트그늘막" : "그늘막",
    detail: detail || null,
    installedYear: facility.installedAt ? Number(facility.installedAt.slice(0, 4)) : null,
    heightM: null,
    widthM: facility.widthM,
    managerName: facility.district === "수성구" ? "대구광역시 수성구청" : "대구광역시 동구청",
    managerPhone: null,
    datasetUpdatedAt: facility.datasetUpdatedAt,
    providerCode: facility.sourceId,
    providerName: facility.source === "SUSEONG_SHADE_API" ? "대구광역시 수성구" : "대구광역시 동구",
    coordinateSource: "ADDRESS_GEOCODE",
  };
}

async function run(): Promise<void> {
  const serviceKey = process.env["DATA_GO_SERVICE_KEY"]?.trim();
  if (!serviceKey) throw new Error("DATA_GO_SERVICE_KEY is required");
  const naverClientId = process.env["NAVER_MAPS_CLIENT_ID"]?.trim();
  const naverClientSecret = process.env["NAVER_MAPS_CLIENT_SECRET"]?.trim();
  const providers = {
    naver:
      naverClientId && naverClientSecret
        ? createNaverGeocoder({
            clientId: naverClientId,
            clientSecret: naverClientSecret,
          })
        : null,
  };
  if (!providers.naver) {
    throw new Error("NAVER server geocoding credentials are required");
  }

  const [suseong, donggu] = await Promise.all([
    createSuseongShadeClient({ serviceKey }).list({ page: 1, perPage: 1_000 }),
    createDongguSmartShadeClient({ serviceKey }).list({ page: 1, perPage: 100 }),
  ]);
  const facilities = [...suseong.items, ...donggu.items];
  if (suseong.items.length !== suseong.totalCount || donggu.items.length !== donggu.totalCount) {
    throw new Error("District shade API pagination was incomplete");
  }
  const cachePath = resolve(process.cwd(), CACHE_PATH);
  const cache = await readCache(cachePath);
  const addresses = [
    ...new Set(facilities.map(({ address }) => normalizedAddress(address))),
  ].filter((address) => cache[address] === undefined);
  await mapWithConcurrency(addresses, 4, async (address) => {
    const facility = facilities.find(
      (candidate) => normalizedAddress(candidate.address) === address,
    );
    if (!facility) return;
    const coordinate = await geocodeAddress(address, facility.district, providers);
    if (coordinate) cache[address] = coordinate;
  });

  const unresolved = facilities
    .filter(({ address }) => cache[normalizedAddress(address)] === undefined)
    .map(({ sourceId, address }) => ({ sourceId, address }));
  const canopies = facilities.flatMap((facility) => {
    const coordinate = cache[normalizedAddress(facility.address)];
    return coordinate ? [toOfficialCanopy(facility, coordinate)] : [];
  });
  const syncedAt = new Date().toISOString();
  const output = {
    schemaVersion: 1,
    syncedAt,
    complete: unresolved.length === 0,
    sourceCounts: {
      suseong: suseong.totalCount,
      donggu: donggu.totalCount,
      total: facilities.length,
      geocoded: canopies.length,
      unresolved: unresolved.length,
    },
    geocodeMethod: "주소 기반 NAVER Geocode 변환. 교차로 내 실제 설치 지점과 오차가 있을 수 있음.",
    unresolved,
    canopies,
  } as const;
  const outputPath = resolve(process.cwd(), OUTPUT_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await Promise.all([
    writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8"),
    writeFile(cachePath, JSON.stringify(cache, null, 2) + "\n", "utf8"),
  ]);
  console.log(
    JSON.stringify(
      {
        syncedAt,
        ...output.sourceCounts,
        complete: output.complete,
        outputPath,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "District shade sync failed");
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) void main();
