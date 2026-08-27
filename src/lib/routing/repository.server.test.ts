import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseRoutingRepository,
  RoutingRepositoryError,
  type RoutingDatabaseClient,
} from "./repository.server";

const route = [
  [128.6, 35.87],
  [128.61, 35.871],
] as const;

function queryResult(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  return {
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnValue(result),
    then: result.then.bind(result),
  };
}

function clientWith(options?: {
  rpcData?: unknown;
  rpcError?: unknown;
  releases?: unknown;
  cache?: unknown;
}) {
  const releaseQuery = queryResult(
    options?.releases ?? [
      { dataset: "REST_SPOT", version: "2026-08-20" },
      { dataset: "BUILDING", version: "2026-08-23" },
    ],
  );
  const cacheQuery = queryResult(options?.cache ?? null);
  const upsertResult = Promise.resolve({ data: null, error: null });
  const cacheTable = {
    select: vi.fn(() => cacheQuery),
    upsert: vi.fn(() => upsertResult),
  };
  const releaseTable = {
    select: vi.fn(() => releaseQuery),
    upsert: vi.fn(() => upsertResult),
  };
  const client = {
    rpc: vi.fn().mockResolvedValue({
      data: options?.rpcData,
      error: options?.rpcError ?? null,
    }),
    from: vi.fn((table: string) => (table === "route_cache" ? cacheTable : releaseTable)),
  } as unknown as RoutingDatabaseClient;

  return { client, releaseQuery, cacheQuery, cacheTable };
}

const spatialPayload = {
  buildings: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      heightM: "12.5",
      heightSource: "building register",
      heightIsEstimated: false,
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [128.6, 35.87],
              [128.601, 35.87],
              [128.601, 35.871],
              [128.6, 35.87],
            ],
          ],
        ],
      },
      confidence: "VERIFIED_SOURCE",
      coverage: "DAEGU_ALL",
      unknownReason: null,
    },
  ],
  restSpots: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      type: "BENCH",
      geometry: { type: "Point", coordinates: [128.605, 35.87] },
      confidence: "VERIFIED_SOURCE",
      coverage: "PARK_ONLY",
      unknownReason: "공원 밖 미제공",
    },
  ],
  barriers: [
    {
      id: "00000000-0000-4000-8000-000000000003",
      type: "STEEP_SLOPE",
      slopePercent: "6.25",
      geometry: {
        type: "LineString",
        coordinates: [
          [128.604, 35.869],
          [128.604, 35.871],
        ],
      },
      confidence: "DERIVED",
      coverage: "DISTRICT_ONLY",
      unknownReason: null,
    },
  ],
  spatialVersion: "BUILDING:2026-08-23|REST_SPOT:2026-08-20",
};

describe("Supabase routing repository", () => {
  it("calls the service-role spatial RPC with a 4326 LineString and strictly maps evidence", async () => {
    const { client } = clientWith({ rpcData: spatialPayload });
    const repository = createSupabaseRoutingRepository(client);

    await expect(repository.getSpatialContext(route, 1.75)).resolves.toMatchObject({
      spatialVersion: spatialPayload.spatialVersion,
      buildings: [{ heightM: 12.5, coverage: "DAEGU_ALL" }],
      restSpots: [{ coordinate: [128.605, 35.87], coverage: "PARK_ONLY" }],
      barriers: [{ barrierType: "STEEP_SLOPE", slopePercent: 6.25 }],
    });
    expect(client.rpc).toHaveBeenCalledWith("route_spatial_context_at_time", {
      p_route: "SRID=4326;LINESTRING(128.6 35.87,128.61 35.871)",
      p_buffer_m: 30,
      p_shadow_factor: 1.75,
      p_max_shadow_m: 300,
    });
  });

  it("rejects an invalid shadow factor before querying Supabase", async () => {
    const { client } = clientWith({ rpcData: spatialPayload });
    const repository = createSupabaseRoutingRepository(client);

    await expect(repository.getSpatialContext(route, Number.POSITIVE_INFINITY)).rejects.toEqual(
      new RoutingRepositoryError("INVALID_ROUTE"),
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed or over-posted spatial rows without leaking database diagnostics", async () => {
    const { client } = clientWith({
      rpcData: { ...spatialPayload, secret: "must-not-pass" },
    });
    const repository = createSupabaseRoutingRepository(client);

    await expect(repository.getSpatialContext(route)).rejects.toEqual(
      new RoutingRepositoryError("INVALID_SPATIAL_RESPONSE"),
    );
    await expect(repository.getSpatialContext(route)).rejects.not.toThrow("must-not-pass");
  });

  it("builds a deterministic active spatial release version", async () => {
    const { client, releaseQuery } = clientWith();
    const repository = createSupabaseRoutingRepository(client);

    await expect(repository.getSpatialVersion()).resolves.toBe(
      "BUILDING:2026-08-23|REST_SPOT:2026-08-20",
    );
    expect(releaseQuery.eq).toHaveBeenCalledWith("active", true);
    expect(releaseQuery.order).toHaveBeenCalledWith("dataset", { ascending: true });
  });

  it("reads only an unexpired cache row and keeps route_result opaque for service validation", async () => {
    const result = { state: "PARTIAL", privateValue: "still opaque" };
    const { client, cacheQuery } = clientWith({
      cache: {
        route_result: result,
        expires_at: "2026-08-24T00:10:00.000Z",
      },
    });
    const repository = createSupabaseRoutingRepository(client);
    const cacheKey = "a".repeat(64);

    await expect(
      repository.readCache(cacheKey, new Date("2026-08-24T00:00:00.000Z")),
    ).resolves.toEqual({ result, expiresAt: "2026-08-24T00:10:00.000Z" });
    expect(cacheQuery.eq).toHaveBeenCalledWith("cache_key", cacheKey);
    expect(cacheQuery.gt).toHaveBeenCalledWith("expires_at", "2026-08-24T00:00:00.000Z");
  });

  it("upserts a validated SHA-256 key and the exact server result", async () => {
    const { client, cacheTable } = clientWith();
    const repository = createSupabaseRoutingRepository(client);
    const result = { state: "READY" };

    await repository.writeCache({
      cacheKey: "b".repeat(64),
      destinationShelterId: "DG-0001",
      spatialVersion: "BUILDING:v1",
      solarBucket: "2026-08-24T00:00:00.000Z",
      result,
      expiresAt: "2026-08-24T00:10:00.000Z",
    });

    expect(cacheTable.upsert).toHaveBeenCalledWith(
      {
        cache_key: "b".repeat(64),
        destination_shelter_id: "DG-0001",
        spatial_version: "BUILDING:v1",
        solar_bucket: "2026-08-24T00:00:00.000Z",
        route_result: result,
        expires_at: "2026-08-24T00:10:00.000Z",
      },
      { onConflict: "cache_key" },
    );
  });

  it("maps every database or cache shape failure to a stable repository code", async () => {
    const { client } = clientWith({ rpcData: spatialPayload, rpcError: { message: "raw SQL" } });
    const repository = createSupabaseRoutingRepository(client);

    await expect(repository.getSpatialContext(route)).rejects.toMatchObject({
      name: "RoutingRepositoryError",
      code: "SPATIAL_QUERY_FAILED",
      message: "Routing repository failed: SPATIAL_QUERY_FAILED",
    });
  });
});
