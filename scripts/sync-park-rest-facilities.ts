import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDaeguParkFacilityClient,
  type DaeguPark,
  type DaeguParkFacility,
} from "../src/integrations/heat-relief/park-facility.server.ts";
import { createParkApiRequestQueue } from "../src/integrations/heat-relief/park-api-request.server.ts";
import { isParkFacilitySafeForRouting } from "../src/lib/heat-relief/park-facility-policy.ts";

const OUTPUT_PATH = "data/heat-relief/api/park-rest-facilities.json";
const DAEGU_CENTER = { latitude: 35.8714, longitude: 128.6014 } as const;

export interface SyncedParkRestFacility {
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

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(values[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function toSyncedFacility(facility: DaeguParkFacility): SyncedParkRestFacility | null {
  if (!isParkFacilitySafeForRouting(facility) || facility.restType === null) return null;
  return {
    sourceFeatureId: facility.sourceId,
    restType: facility.restType,
    name:
      facility.restType === "BENCH"
        ? facility.parkName + " 벤치"
        : facility.restType === "PAVILION"
          ? facility.parkName + " 정자·쉼터"
          : facility.parkName + " " + facility.facilityName,
    parkName: facility.parkName,
    facilityName: facility.facilityName,
    latitude: facility.coordinate.latitude,
    longitude: facility.coordinate.longitude,
    condition: facility.condition,
    repairRequired: facility.repairRequired,
    datasetUpdatedAt: facility.datasetUpdatedAt,
    source: "DAEGU_PARK_FACILITY_API",
  };
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  return values.reduce(
    (counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    },
    {} as Record<T, number>,
  );
}

async function fetchFacilitiesForPark(
  client: ReturnType<typeof createDaeguParkFacilityClient>,
  park: DaeguPark,
  request: ReturnType<typeof createParkApiRequestQueue>,
): Promise<readonly DaeguParkFacility[]> {
  const firstPage = await request(() =>
    client.listFacilities({
      parkManagementNumber: park.managementNumber,
      latitude: park.coordinate.latitude,
      longitude: park.coordinate.longitude,
      radiusKm: 5,
      page: 1,
      perPage: 1_000,
    }),
  );
  if (firstPage.items.length >= firstPage.totalCount) return firstPage.items;
  const pageCount = Math.ceil(firstPage.totalCount / 1_000);
  const remaining = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      request(() =>
        client.listFacilities({
          parkManagementNumber: park.managementNumber,
          latitude: park.coordinate.latitude,
          longitude: park.coordinate.longitude,
          radiusKm: 5,
          page: index + 2,
          perPage: 1_000,
        }),
      ),
    ),
  );
  return [...firstPage.items, ...remaining.flatMap(({ items }) => items)];
}

async function run(): Promise<void> {
  const serviceKey = process.env["DATA_GO_SERVICE_KEY"]?.trim();
  if (!serviceKey) throw new Error("DATA_GO_SERVICE_KEY is required");
  const client = createDaeguParkFacilityClient({ serviceKey, timeoutMs: 15_000 });
  const request = createParkApiRequestQueue({ minimumIntervalMs: 300 });
  const parksPage = await request(() =>
    client.listParks({
      ...DAEGU_CENTER,
      radiusKm: 50,
      page: 1,
      perPage: 1_000,
    }),
  );
  if (parksPage.items.length !== parksPage.totalCount) {
    throw new Error("Daegu park list pagination was incomplete");
  }

  const facilityPages = await mapWithConcurrency(parksPage.items, 4, async (park) =>
    fetchFacilitiesForPark(client, park, request),
  );
  const allFacilities = facilityPages.flat();
  const facilities = allFacilities
    .flatMap((facility) => {
      const synced = toSyncedFacility(facility);
      return synced ? [synced] : [];
    })
    .sort(
      (left, right) =>
        left.restType.localeCompare(right.restType) ||
        left.parkName.localeCompare(right.parkName, "ko") ||
        left.sourceFeatureId.localeCompare(right.sourceFeatureId),
    );
  const uniqueIds = new Set(facilities.map(({ sourceFeatureId }) => sourceFeatureId));
  if (uniqueIds.size !== facilities.length) {
    throw new Error("Park rest facility source IDs are not unique");
  }
  const syncedAt = new Date().toISOString();
  const output = {
    schemaVersion: 1,
    syncedAt,
    complete: true,
    source: {
      name: "대구광역시 공원시설물정보API",
      url: "https://www.data.go.kr/data/15109600/openapi.do",
    },
    audit: {
      parkCount: parksPage.items.length,
      rawFacilityCount: allFacilities.length,
      heatReliefFacilityCount: facilities.length,
      excludedCount: allFacilities.length - facilities.length,
      restTypeCounts: countBy(facilities.map(({ restType }) => restType)),
      unsafeExcludedCount: allFacilities.filter(
        (facility) => facility.restType !== null && !isParkFacilitySafeForRouting(facility),
      ).length,
    },
    facilities,
  } as const;
  const outputPath = resolve(process.cwd(), OUTPUT_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ syncedAt, ...output.audit, outputPath }, null, 2));
}

async function main(): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Park facility sync failed");
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) void main();
