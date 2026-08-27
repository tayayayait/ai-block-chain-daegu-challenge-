import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodePublicCsv,
  mergeDaeguShadeCanopies,
  parseShadeCanopyCsv,
  type OfficialShadeCanopy,
} from "../src/lib/heat-relief/shade-canopy-csv.ts";

const NATIONAL_FILE = "전국그늘막쉼터표준데이터.csv";
const DISTRICT_FILES = [
  "대구광역시_남구_그늘막쉼터.csv",
  "대구광역시_달서구_그늘막쉼터.csv",
  "대구광역시_달성군_그늘막쉼터.csv",
  "대구광역시_중구_그늘막쉼터.csv",
] as const;
const OSM_DIRECTORY = "data/spatial/osm/20260824-live";
const DISTRICT_API_PATH = "data/heat-relief/api/district-shade-canopies.json";
const PARK_API_PATH = "data/heat-relief/api/park-rest-facilities.json";
const DATA_OUTPUT_DIRECTORY = "data/heat-relief/current";
const PUBLIC_OUTPUT_PATH = "public/data/heat-relief/daegu-points.json";

type Position = readonly [longitude: number, latitude: number];
type RestType = "BENCH" | "PAVILION" | "SHADE_CANOPY" | "PARK_FACILITY";

interface RestSpotFeature {
  readonly type: "Feature";
  readonly geometry: Readonly<{ type: "Point"; coordinates: Position }>;
  readonly properties: Readonly<{
    sourceFeatureId: string;
    observedAt?: string | null;
    unknownReason?: string | null;
    restType: RestType;
  }>;
}

interface RestSpotCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly RestSpotFeature[];
}

interface OsmManifest {
  readonly datasetUpdatedAt: string;
  readonly coverageGeometry: unknown;
}

interface SyncedParkRestFacility {
  readonly sourceFeatureId: string;
  readonly restType: "BENCH" | "PAVILION" | "PARK_FACILITY";
  readonly name: string;
  readonly parkName: string;
  readonly facilityName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly condition: string | null;
  readonly repairRequired: boolean | null;
  readonly datasetUpdatedAt: string | null;
  readonly source: "DAEGU_PARK_FACILITY_API";
}

interface ParkFacilitySync {
  readonly complete?: boolean;
  readonly audit?: Readonly<{
    heatReliefFacilityCount?: number;
    restTypeCounts?: Readonly<Record<string, number>>;
  }>;
  readonly facilities?: readonly SyncedParkRestFacility[];
}

function dateAtUtcMidnight(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().replaceAll(".", "-").replaceAll("/", "-");
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(normalized);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function shadeSpatialFeature(entry: OfficialShadeCanopy): RestSpotFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [entry.coordinate.longitude, entry.coordinate.latitude],
    },
    properties: {
      sourceFeatureId: entry.sourceFeatureId,
      observedAt: dateAtUtcMidnight(entry.datasetUpdatedAt),
      restType: "SHADE_CANOPY",
    },
  };
}

function publicShadePoint(entry: OfficialShadeCanopy) {
  return {
    id: entry.sourceFeatureId,
    type: "SHADE_CANOPY" as const,
    name: entry.name,
    district: entry.district,
    latitude: entry.coordinate.latitude,
    longitude: entry.coordinate.longitude,
    detail: entry.detail,
    address: entry.roadAddress ?? entry.lotAddress,
    source: entry.source,
    datasetUpdatedAt: entry.datasetUpdatedAt,
    coordinateSource: entry.coordinateSource ?? "PROVIDED",
  };
}

function publicOsmPoint(feature: RestSpotFeature) {
  const [longitude, latitude] = feature.geometry.coordinates;
  const type = feature.properties.restType;
  return {
    id: feature.properties.sourceFeatureId,
    type,
    name:
      type === "BENCH"
        ? "공원·보행로 벤치"
        : type === "PAVILION"
          ? "정자·파고라"
          : type === "SHADE_CANOPY"
            ? "그늘 시설"
            : "공원 편의시설",
    district: null,
    latitude,
    longitude,
    detail: null,
    address: null,
    source: "OPENSTREETMAP" as const,
    datasetUpdatedAt: feature.properties.observedAt ?? null,
    coordinateSource: "PROVIDED" as const,
  };
}

function parkSpatialFeature(entry: SyncedParkRestFacility): RestSpotFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [entry.longitude, entry.latitude],
    },
    properties: {
      sourceFeatureId: entry.sourceFeatureId,
      observedAt: dateAtUtcMidnight(entry.datasetUpdatedAt),
      restType: entry.restType,
    },
  };
}

function publicParkPoint(entry: SyncedParkRestFacility) {
  return {
    id: entry.sourceFeatureId,
    type: entry.restType,
    name: entry.name,
    district: null,
    latitude: entry.latitude,
    longitude: entry.longitude,
    detail: entry.condition
      ? `${entry.facilityName} · 시설 상태 ${entry.condition}`
      : entry.facilityName,
    address: null,
    source: entry.source,
    datasetUpdatedAt: entry.datasetUpdatedAt,
    coordinateSource: "PROVIDED" as const,
  };
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function prepare() {
  const workspace = process.cwd();
  const national = parseShadeCanopyCsv(
    decodePublicCsv(await readFile(resolve(workspace, NATIONAL_FILE))),
    "NATIONAL_STANDARD_CSV",
  );
  const districtSnapshots = await Promise.all(
    DISTRICT_FILES.map(async (file) =>
      parseShadeCanopyCsv(
        decodePublicCsv(await readFile(resolve(workspace, file))),
        "DAEGU_DISTRICT_CSV",
      ),
    ),
  );
  let districtApiCanopies: OfficialShadeCanopy[] = [];
  try {
    const apiSync = JSON.parse(await readFile(resolve(workspace, DISTRICT_API_PATH), "utf8")) as {
      complete?: boolean;
      sourceCounts?: { total?: number };
      canopies?: OfficialShadeCanopy[];
    };
    if (
      apiSync.complete !== true ||
      !Array.isArray(apiSync.canopies) ||
      apiSync.sourceCounts?.total !== apiSync.canopies.length
    ) {
      throw new Error("District shade API sync is incomplete or malformed");
    }
    districtApiCanopies = apiSync.canopies;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const csvCanopies = mergeDaeguShadeCanopies(national, districtSnapshots);
  const apiSnapshots = [...new Set(districtApiCanopies.map(({ district }) => district))].map(
    (district) => districtApiCanopies.filter((entry) => entry.district === district),
  );
  const canopies = mergeDaeguShadeCanopies(national, [...districtSnapshots, ...apiSnapshots]);
  const [osmCollection, osmManifest] = await Promise.all([
    readFile(resolve(workspace, OSM_DIRECTORY, "rest-spot-features.geojson"), "utf8").then(
      (value) => JSON.parse(value) as RestSpotCollection,
    ),
    readFile(resolve(workspace, OSM_DIRECTORY, "rest-spot-manifest.json"), "utf8").then(
      (value) => JSON.parse(value) as OsmManifest,
    ),
  ]);
  const parkApiSync = JSON.parse(
    await readFile(resolve(workspace, PARK_API_PATH), "utf8"),
  ) as ParkFacilitySync;
  const parkFacilities = parkApiSync.facilities;
  if (
    parkApiSync.complete !== true ||
    !Array.isArray(parkFacilities) ||
    parkApiSync.audit?.heatReliefFacilityCount !== parkFacilities.length
  ) {
    throw new Error("Park facility API sync is incomplete or malformed");
  }
  if (
    parkFacilities.some(
      (entry) =>
        !entry.sourceFeatureId ||
        !["BENCH", "PAVILION", "PARK_FACILITY"].includes(entry.restType) ||
        !Number.isFinite(entry.latitude) ||
        !Number.isFinite(entry.longitude) ||
        entry.source !== "DAEGU_PARK_FACILITY_API",
    )
  ) {
    throw new Error("Park facility API sync contains an invalid facility");
  }
  if (csvCanopies.length !== 482 || canopies.length !== 482 + districtApiCanopies.length) {
    throw new Error(
      "Expected " +
        (482 + districtApiCanopies.length) +
        " merged official shade canopies, received " +
        canopies.length,
    );
  }
  const osmCounts = osmCollection.features.reduce<Record<string, number>>((counts, feature) => {
    counts[feature.properties.restType] = (counts[feature.properties.restType] ?? 0) + 1;
    return counts;
  }, {});
  if (osmCounts["BENCH"] !== 117 || osmCounts["PAVILION"] !== 113) {
    throw new Error("The reviewed OSM rest-spot release no longer matches its expected audit");
  }
  const parkCounts = parkFacilities.reduce<Record<string, number>>((counts, facility) => {
    counts[facility.restType] = (counts[facility.restType] ?? 0) + 1;
    return counts;
  }, {});
  for (const restType of ["BENCH", "PAVILION", "PARK_FACILITY"] as const) {
    if ((parkApiSync.audit.restTypeCounts?.[restType] ?? 0) !== (parkCounts[restType] ?? 0)) {
      throw new Error(`Park facility ${restType} audit count does not match its records`);
    }
  }

  const spatialCollection: RestSpotCollection = {
    type: "FeatureCollection",
    features: [
      ...osmCollection.features,
      ...canopies.map(shadeSpatialFeature),
      ...parkFacilities.map(parkSpatialFeature),
    ],
  };
  const versionHash = createHash("sha256")
    .update(JSON.stringify(spatialCollection))
    .digest("hex")
    .slice(0, 12);
  const shadeDates = canopies
    .map(({ datasetUpdatedAt }) => dateAtUtcMidnight(datasetUpdatedAt))
    .filter((value): value is string => value !== null);
  const datasetUpdatedAt = [osmManifest.datasetUpdatedAt, ...shadeDates].sort().at(-1);
  if (!datasetUpdatedAt) throw new Error("Dataset timestamp is missing");
  const version = `daegu-heat-relief-${datasetUpdatedAt.slice(0, 10).replaceAll("-", "")}-${versionHash}`;
  const manifest = {
    schemaVersion: 1,
    version,
    dataset: "REST_SPOT",
    sourceName:
      "공공데이터포털 그늘막 표준데이터·대구 구군 갱신자료·대구 공원시설물·OpenStreetMap 휴식시설 통합",
    sourceUrl: "https://www.data.go.kr/data/15129447/standard.do",
    licenseCode: "PUBLIC-DATA-PORTAL-AND-ODBL-1.0",
    attribution: "공공데이터포털 제공기관·대구광역시 및 © OpenStreetMap contributors",
    sourceCrs: "EPSG:4326",
    targetCrs: "EPSG:4326",
    coverageCrs: "EPSG:4326",
    datasetUpdatedAt,
    coverage: "COMMUNITY_PARTIAL",
    confidence: "DERIVED",
    unknownReason:
      "그늘막·공원시설은 공개된 설치·시설 대장이며 당일 펼침 여부와 현장 이용 가능 상태는 보장하지 않습니다. 공원시설 상태 기준일이 오래된 항목은 현장 확인이 필요합니다.",
    coverageGeometry: osmManifest.coverageGeometry,
    quality: { maxDuplicateRate: 0.1, maxDatasetAgeDays: 3650 },
    rules: { kind: "REST_SPOT" },
  } as const;
  const districtCounts = Object.fromEntries(
    [...new Set(canopies.map(({ district }) => district))]
      .sort((left, right) => left.localeCompare(right, "ko"))
      .map((district) => [
        district,
        canopies.filter((entry) => entry.district === district).length,
      ]),
  );
  const publicCatalog = {
    schemaVersion: 1,
    version,
    datasetUpdatedAt,
    summary: {
      total: spatialCollection.features.length,
      shadeCanopy: canopies.length,
      bench: (osmCounts["BENCH"] ?? 0) + (parkCounts["BENCH"] ?? 0),
      pavilion: (osmCounts["PAVILION"] ?? 0) + (parkCounts["PAVILION"] ?? 0),
      parkFacility: (osmCounts["PARK_FACILITY"] ?? 0) + (parkCounts["PARK_FACILITY"] ?? 0),
    },
    sources: [
      {
        name: "전국그늘막쉼터표준데이터",
        url: "https://www.data.go.kr/data/15129447/standard.do",
      },
      {
        name: "대구 구·군 그늘막 갱신 CSV",
        url: "https://www.data.go.kr/",
      },
      {
        name: "대구 수성구 그늘막 설치현황 API",
        url: "https://www.data.go.kr/data/15116975/fileData.do",
      },
      {
        name: "대구 동구 스마트 그늘막 설치대장 API",
        url: "https://www.data.go.kr/data/15110598/openapi.do",
      },
      {
        name: "대구광역시 공원시설물정보API",
        url: "https://www.data.go.kr/data/15109600/openapi.do",
      },
      {
        name: "OpenStreetMap",
        url: "https://www.openstreetmap.org/relation/2395674",
      },
    ],
    points: [
      ...osmCollection.features.map(publicOsmPoint),
      ...canopies.map(publicShadePoint),
      ...parkFacilities.map(publicParkPoint),
    ],
  } as const;
  const sourceAudit = {
    schemaVersion: 1,
    ok: true,
    version,
    nationalDaeguCount: national.filter(({ city }) => city === "대구광역시").length,
    districtApiCount: districtApiCanopies.length,
    officialShadeCanopyCount: canopies.length,
    districtCounts,
    osmCounts,
    parkFacilityApiCounts: parkCounts,
    parkFacilityApiCount: parkFacilities.length,
    combinedRestSpotCount: spatialCollection.features.length,
    replacementRule:
      "구·군 CSV가 존재하는 행정구역은 해당 최신 스냅샷 전체로 전국 표준데이터 행을 교체",
  } as const;
  return { spatialCollection, manifest, publicCatalog, sourceAudit };
}

async function run(arguments_: readonly string[]): Promise<void> {
  const mode = arguments_.length === 1 && arguments_[0] === "--check" ? "check" : "write";
  if (
    arguments_.length > 1 ||
    (arguments_.length === 1 && !["--check", "--write"].includes(arguments_[0] ?? ""))
  ) {
    throw new Error("Usage: bun scripts/prepare-heat-relief-data.ts [--check|--write]");
  }
  const result = await prepare();
  if (mode === "write") {
    const dataOutput = resolve(process.cwd(), DATA_OUTPUT_DIRECTORY);
    const publicOutput = resolve(process.cwd(), PUBLIC_OUTPUT_PATH);
    await Promise.all([
      mkdir(dataOutput, { recursive: true }),
      mkdir(dirname(publicOutput), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        resolve(dataOutput, "rest-spot-features.geojson"),
        serialize(result.spatialCollection),
        "utf8",
      ),
      writeFile(resolve(dataOutput, "rest-spot-manifest.json"), serialize(result.manifest), "utf8"),
      writeFile(resolve(dataOutput, "source-audit.json"), serialize(result.sourceAudit), "utf8"),
      writeFile(publicOutput, serialize(result.publicCatalog), "utf8"),
    ]);
  }
  console.log(serialize(result.sourceAudit).trimEnd());
}

async function main(): Promise<void> {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Heat-relief preparation failed");
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) void main();
