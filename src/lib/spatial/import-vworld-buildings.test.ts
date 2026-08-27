import { gzipSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyVworldBuildingBundle,
  inspectVworldBuildingBundle,
} from "../../../scripts/import-vworld-buildings.ts";

const temporaryDirectories: string[] = [];

function feature(index: number, estimated = false) {
  return {
    sourceFeatureId: `VWORLD_A0_${index}_A1_${index}`,
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [128.6, 35.8],
            [128.601, 35.8],
            [128.601, 35.801],
            [128.6, 35.8],
          ],
        ],
      ],
    },
    heightM: estimated ? 9 : 12.5,
    heightSource: estimated ? "DERIVED_A26_GROUND_FLOORS" : "VWORLD_GIS_BUILDING_A16",
    heightIsEstimated: estimated,
    heightEstimationVersion: estimated ? "vworld-a26-3m-v1" : null,
    observedAt: "2026-08-06T00:00:00+09:00",
    confidence: estimated ? "DERIVED" : "VERIFIED_SOURCE",
    coverage: "DAEGU_ALL",
    unknownReason: estimated ? "A26 지상층수에 3m를 곱해 추정함" : null,
  } as const;
}

async function bundle(featureCount = 3) {
  const directory = await mkdtemp(join(tmpdir(), "vworld-import-test-"));
  temporaryDirectories.push(directory);
  const features = Array.from({ length: featureCount }, (_, index) => feature(index, index === 1));
  const manifest = {
    schemaVersion: 1,
    dataset: "BUILDING",
    version: "vworld-daegu-20260806",
    sourceName: "국토교통부 GIS건물통합정보",
    sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=18",
    licenseCode: "PUBLIC_DATA_UNRESTRICTED",
    attribution: "국토교통부·VWorld",
    sourceCrs: "EPSG:5186",
    targetCrs: "EPSG:4326",
    datasetUpdatedAt: "2026-08-06T00:00:00+09:00",
    coverage: "DAEGU_ALL",
    confidence: "DERIVED",
    unknownReason: "높이 누락 건물은 그림자 계산에서 제외됨",
    expectedFeatureCount: featureCount,
    featureFormat: "NDJSON_GZIP",
    rules: {
      directHeightField: "A16",
      floorCountField: "A26",
      floorHeightM: 3,
      directHeightRangeM: [1, 200],
      heightEstimationVersion: "vworld-a26-3m-v1",
    },
  };
  const audit = {
    schemaVersion: 1,
    ok: true,
    sourceCrs: "EPSG:5186",
    recordCount: featureCount,
    acceptedCount: featureCount,
    directHeightCount: featureCount - (featureCount > 1 ? 1 : 0),
    estimatedHeightCount: featureCount > 1 ? 1 : 0,
    missingHeightCount: 0,
    outsideDaeguCount: 0,
    invalidGeometryCount: 0,
    duplicateSourceIdCount: 0,
    deletedRecordCount: 0,
    districtCounts: { "27110": featureCount },
    sourceDateCounts: { "20260806": featureCount },
  };
  const manifestPath = join(directory, "vworld-daegu-buildings.manifest.json");
  const auditPath = join(directory, "vworld-daegu-buildings.audit.json");
  const featurePath = join(directory, "vworld-daegu-buildings.ndjson.gz");
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(manifest)),
    writeFile(auditPath, JSON.stringify(audit)),
    writeFile(
      featurePath,
      gzipSync(`${features.map((item) => JSON.stringify(item)).join("\n")}\n`),
    ),
  ]);
  return { manifestPath, auditPath, featurePath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("VWorld staged building importer", () => {
  it("validates the gzip stream in bounded batches without loading the full dataset", async () => {
    const paths = await bundle(3);
    const progress = vi.fn();

    await expect(
      inspectVworldBuildingBundle({ ...paths, batchSize: 2, onBatch: progress }),
    ).resolves.toMatchObject({ featureCount: 3, directHeightCount: 2, estimatedHeightCount: 1 });

    expect(progress.mock.calls.map(([batch]) => batch.length)).toEqual([2, 1]);
  });

  it("begins, appends idempotent batches, and activates only through finalize", async () => {
    const paths = await bundle(3);
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: HeadersInit }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body, headers: init?.headers ?? {} });
      if (url.endsWith("/begin_vworld_building_import")) {
        return Response.json({
          releaseId: "60000000-0000-4000-8000-000000000099",
          active: false,
          loadedCount: 0,
          expectedCount: 3,
        });
      }
      if (url.endsWith("/append_vworld_building_import")) {
        const features = body["p_features"] as unknown[];
        return Response.json({
          releaseId: "60000000-0000-4000-8000-000000000099",
          insertedCount: features.length,
          loadedCount: Math.min(calls.length * 2, 3),
          expectedCount: 3,
        });
      }
      return Response.json({
        releaseId: "60000000-0000-4000-8000-000000000099",
        active: true,
        featureCount: 3,
      });
    });

    await expect(
      applyVworldBuildingBundle(paths, {
        supabaseUrl: "https://project-ref.supabase.co",
        secretKey: "sb_secret_example-only",
        batchSize: 2,
        fetcher,
      }),
    ).resolves.toMatchObject({ active: true, featureCount: 3, batchCount: 2 });

    expect(calls.map(({ url }) => url.split("/").at(-1))).toEqual([
      "begin_vworld_building_import",
      "append_vworld_building_import",
      "append_vworld_building_import",
      "finalize_vworld_building_import",
    ]);
    expect((calls[1]?.body["p_features"] as unknown[]).length).toBe(2);
    expect((calls[2]?.body["p_features"] as unknown[]).length).toBe(1);
    expect(calls[0]?.headers).toMatchObject({ apikey: "sb_secret_example-only" });
    expect(calls[0]?.headers).not.toHaveProperty("Authorization");
  });

  it("stops before any RPC when the audited count and stream disagree", async () => {
    const paths = await bundle(3);
    const brokenFeaturePath = join(dirname(paths.featurePath), "broken.gz");
    await writeFile(brokenFeaturePath, gzipSync(`${JSON.stringify(feature(1))}\n`));
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      applyVworldBuildingBundle(
        { ...paths, featurePath: brokenFeaturePath },
        {
          supabaseUrl: "https://project-ref.supabase.co",
          secretKey: "header.payload.signature",
          fetcher,
        },
      ),
    ).rejects.toThrow("VWORLD_BUNDLE_COUNT_MISMATCH");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
