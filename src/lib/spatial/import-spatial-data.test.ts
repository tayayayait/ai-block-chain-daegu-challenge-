import { describe, expect, it, vi } from "vitest";

import {
  applySpatialImport,
  prepareSpatialImport,
  transformPositionToWgs84,
} from "../../../scripts/import-spatial-data.ts";

const AUDITED_AT = new Date("2026-08-24T00:00:00.000Z");

function coverageGeometry() {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [128.5, 35.8],
        [128.7, 35.8],
        [128.7, 35.95],
        [128.5, 35.95],
        [128.5, 35.8],
      ],
    ],
  };
}

function commonManifest() {
  return {
    schemaVersion: 1 as const,
    version: "2026-08-20-v1",
    sourceName: "검증용 공간 데이터",
    sourceUrl: "https://data.example.org/spatial/metadata",
    licenseCode: "PUBLIC-DATA",
    attribution: "검증용 제공기관",
    sourceCrs: "EPSG:4326",
    targetCrs: "EPSG:4326" as const,
    coverageCrs: "EPSG:4326" as const,
    datasetUpdatedAt: "2026-08-20T00:00:00.000Z",
    coverage: "DISTRICT_ONLY" as const,
    confidence: "VERIFIED_SOURCE" as const,
    unknownReason: null,
    coverageGeometry: coverageGeometry(),
    quality: {
      maxDuplicateRate: 0,
      maxDatasetAgeDays: 30,
    },
  };
}

function buildingInput() {
  return {
    manifest: {
      ...commonManifest(),
      dataset: "BUILDING" as const,
      rules: {
        kind: "BUILDING" as const,
        allowFloorEstimate: true,
        floorHeightM: 3,
        heightEstimationVersion: "FLOOR_HEIGHT_3M_V1",
      },
    },
    geojson: {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [128.59, 35.86],
                [128.591, 35.86],
                [128.591, 35.861],
                [128.59, 35.861],
                [128.59, 35.86],
              ],
            ],
          },
          properties: {
            sourceFeatureId: "building-height",
            heightM: 12.5,
            heightSource: "SOURCE_HEIGHT_M",
            observedAt: "2026-08-19T00:00:00.000Z",
          },
        },
        {
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [128.6, 35.87],
                [128.601, 35.87],
                [128.601, 35.871],
                [128.6, 35.871],
                [128.6, 35.87],
              ],
            ],
          },
          properties: {
            sourceFeatureId: "building-floor",
            floorCount: 4,
          },
        },
      ],
    },
  };
}

describe("Phase 6 spatial importer", () => {
  it("normalizes valid buildings and records direct versus estimated height provenance", () => {
    const result = prepareSpatialImport(buildingInput(), AUDITED_AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.audit).toMatchObject({
      featureCount: 2,
      acceptedCount: 2,
      duplicateRate: 0,
    });
    expect(result.payload.features).toEqual([
      expect.objectContaining({
        sourceFeatureId: "building-height",
        heightM: 12.5,
        heightSource: "SOURCE_HEIGHT_M",
        heightIsEstimated: false,
        heightEstimationVersion: null,
        geometry: expect.objectContaining({ type: "MultiPolygon" }),
      }),
      expect.objectContaining({
        sourceFeatureId: "building-floor",
        heightM: 12,
        heightSource: "DERIVED_FLOOR_COUNT",
        heightIsEstimated: true,
        heightEstimationVersion: "FLOOR_HEIGHT_3M_V1",
      }),
    ]);
  });

  it("rejects an unlisted CRS instead of inferring it from coordinate ranges", () => {
    const input = buildingInput();
    input.manifest.sourceCrs = "EPSG:3857";

    const result = prepareSpatialImport(input, AUDITED_AT);

    expect(result.ok).toBe(false);
    expect(result.audit.issues).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_CRS", path: "manifest.sourceCrs" }),
    );
  });

  it("rejects a feature outside the declared Daegu coverage geometry", () => {
    const input = {
      manifest: {
        ...commonManifest(),
        dataset: "REST_SPOT" as const,
        rules: { kind: "REST_SPOT" as const },
      },
      geojson: {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [128.8, 35.9] },
            properties: { sourceFeatureId: "outside", restType: "BENCH" as const },
          },
        ],
      },
    };

    const result = prepareSpatialImport(input, AUDITED_AT);

    expect(result.ok).toBe(false);
    expect(result.audit.issues).toContainEqual(
      expect.objectContaining({ code: "OUTSIDE_COVERAGE", path: "geojson.features.0.geometry" }),
    );
  });

  it("fails when normalized feature duplicates exceed the manifest threshold", () => {
    const input = buildingInput();
    const original = input.geojson.features[0];
    expect(original).toBeDefined();
    if (!original) return;
    const duplicate = structuredClone(original);
    duplicate.properties.sourceFeatureId = "different-id-same-building";
    input.geojson.features.push(duplicate);

    const result = prepareSpatialImport(input, AUDITED_AT);

    expect(result.ok).toBe(false);
    expect(result.audit.duplicateRate).toBeCloseTo(1 / 3);
    expect(result.audit.issues).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_RATE_EXCEEDED", path: "geojson.features" }),
    );
  });

  it("counts one redundant row once even when both its source ID and content repeat", () => {
    const input = buildingInput();
    const original = input.geojson.features[0];
    expect(original).toBeDefined();
    if (!original) return;
    input.geojson.features.push(structuredClone(original));

    const result = prepareSpatialImport(input, AUDITED_AT);

    expect(result.ok).toBe(false);
    expect(result.audit.duplicateRate).toBeCloseTo(1 / 3);
    expect(result.audit.issues).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_SOURCE_ID" }),
    );
  });

  it("requires the supplier dataset reference date", () => {
    const input = buildingInput() as unknown as {
      manifest: Record<string, unknown>;
      geojson: unknown;
    };
    delete input.manifest["datasetUpdatedAt"];

    const result = prepareSpatialImport(input, AUDITED_AT);

    expect(result.ok).toBe(false);
    expect(result.audit.issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_INPUT", path: "manifest.datasetUpdatedAt" }),
    );
  });

  it("rejects stale reference dates and DEM barriers at or below five percent", () => {
    const input = {
      manifest: {
        ...commonManifest(),
        datasetUpdatedAt: "2025-01-01T00:00:00.000Z",
        dataset: "BARRIER" as const,
        rules: { kind: "BARRIER" as const },
      },
      geojson: {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            geometry: {
              type: "LineString" as const,
              coordinates: [
                [128.6, 35.87],
                [128.601, 35.871],
              ],
            },
            properties: {
              sourceFeatureId: "dem-low-slope",
              barrierType: "STEEP_SLOPE" as const,
              slopePercent: 5,
              slopeSource: "NGII_DEM",
            },
          },
        ],
      },
    };

    const result = prepareSpatialImport(input, AUDITED_AT);

    expect(result.ok).toBe(false);
    expect(result.audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "STALE_DATASET" }),
        expect.objectContaining({ code: "INVALID_SLOPE" }),
      ]),
    );
  });

  it("transforms the documented EPSG:5187 false origin without guessing axis order", () => {
    expect(transformPositionToWgs84([200_000, 600_000], "EPSG:5187")).toEqual([129, 38]);
  });

  it("transforms the VWorld EPSG:5186 false origin without guessing axis order", () => {
    expect(transformPositionToWgs84([200_000, 600_000], "EPSG:5186")).toEqual([127, 38]);
  });

  it("applies only an already-audited payload through the server-key RPC", async () => {
    const prepared = prepareSpatialImport(buildingInput(), AUDITED_AT);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const fetcher = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          releaseId: "60000000-0000-4000-8000-000000000099",
          dataset: "BUILDING",
          version: "2026-08-20-v1",
          featureCount: 2,
          active: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await expect(
      applySpatialImport(prepared.payload, {
        supabaseUrl: "https://project-ref.supabase.co",
        secretKey: "server-secret",
        fetcher,
      }),
    ).resolves.toMatchObject({ featureCount: 2, active: true });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "https://project-ref.supabase.co/rest/v1/rpc/import_phase6_spatial_release",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "server-secret",
        }),
      }),
    );
    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.headers).not.toHaveProperty("Authorization");
  });

  it("sends an opaque Supabase secret key only in the apikey header", async () => {
    const prepared = prepareSpatialImport(buildingInput(), AUDITED_AT);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        releaseId: "60000000-0000-4000-8000-000000000099",
        dataset: "BUILDING",
        version: "2026-08-20-v1",
        featureCount: 2,
        active: true,
      }),
    );

    await applySpatialImport(prepared.payload, {
      supabaseUrl: "https://project-ref.supabase.co",
      secretKey: "sb_secret_example-only",
      fetcher,
    });

    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({ apikey: "sb_secret_example-only" });
    expect(request?.headers).not.toHaveProperty("Authorization");
  });

  it("adds Bearer authorization for a legacy JWT service key", async () => {
    const prepared = prepareSpatialImport(buildingInput(), AUDITED_AT);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        releaseId: "60000000-0000-4000-8000-000000000099",
        dataset: "BUILDING",
        version: "2026-08-20-v1",
        featureCount: 2,
        active: true,
      }),
    );
    const legacyServiceKey = "header.payload.signature";

    await applySpatialImport(prepared.payload, {
      supabaseUrl: "https://project-ref.supabase.co",
      secretKey: legacyServiceKey,
      fetcher,
    });

    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      apikey: legacyServiceKey,
      Authorization: `Bearer ${legacyServiceKey}`,
    });
  });
});
