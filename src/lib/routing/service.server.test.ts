import { describe, expect, it, vi } from "vitest";

import { routeFixture } from "./fixtures/routes";
import type {
  BuildingEvidence,
  RouteSpatialContext,
  RoutingCacheWrite,
  RoutingRepository,
} from "./repository.server";
import {
  planShadeRoute,
  RoutePlanDtoSchema,
  type RoutingServiceDependencies,
  type TmapPedestrianRoutingClient,
} from "./service.server";
import type { GeoPosition, RouteCandidate, TmapPedestrianSearchOption } from "./types";

const input = {
  start: [128.6, 35.87] as const,
  destination: [128.62, 35.88] as const,
  shelterId: "DG-0001",
  at: "2026-08-24T12:00:00+09:00",
};

function candidate(
  searchOption: TmapPedestrianSearchOption,
  coordinates: readonly GeoPosition[],
  distanceM: number,
): RouteCandidate {
  return routeFixture({
    id: `candidate-${searchOption}`,
    searchOption,
    coordinates,
    distanceM,
    elderDurationSec: Math.ceil(distanceM / 0.75),
  });
}

const candidates: Readonly<Record<TmapPedestrianSearchOption, RouteCandidate>> = {
  "30": candidate(
    "30",
    [
      [128.6, 35.87],
      [128.604, 35.87],
    ],
    420,
  ),
  "10": candidate(
    "10",
    [
      [128.6, 35.871],
      [128.606, 35.871],
    ],
    560,
  ),
  "0": candidate(
    "0",
    [
      [128.6, 35.872],
      [128.607, 35.872],
    ],
    650,
  ),
  "4": candidate(
    "4",
    [
      [128.6, 35.873],
      [128.608, 35.873],
    ],
    720,
  ),
};

const building: BuildingEvidence = {
  id: "00000000-0000-4000-8000-000000000001",
  heightM: 12,
  heightSource: "building register",
  heightIsEstimated: false,
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [128.5999, 35.8699],
        [128.6022, 35.8699],
        [128.6022, 35.8701],
        [128.5999, 35.8701],
        [128.5999, 35.8699],
      ],
    ],
  },
  confidence: "VERIFIED_SOURCE" as const,
  coverage: "DAEGU_ALL" as const,
  unknownReason: null,
};

const completeContext: RouteSpatialContext = {
  buildings: [building],
  restSpots: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      type: "BENCH",
      coordinate: [128.602, 35.87],
      confidence: "VERIFIED_SOURCE",
      coverage: "DAEGU_ALL",
      unknownReason: null,
    },
  ],
  barriers: [],
  spatialVersion: "BARRIER:v1|BUILDING:v1|REST_SPOT:v1",
};

function repository(overrides: Partial<RoutingRepository> = {}) {
  let cached: { result: unknown; expiresAt: string } | null = null;
  const writes: RoutingCacheWrite[] = [];
  const value: RoutingRepository = {
    getSpatialVersion: vi.fn().mockResolvedValue(completeContext.spatialVersion),
    getSpatialContext: vi.fn().mockResolvedValue(completeContext),
    readCache: vi.fn(async () => cached),
    writeCache: vi.fn(async (record) => {
      writes.push(record);
      cached = { result: record.result, expiresAt: record.expiresAt };
    }),
    ...overrides,
  };
  return { value, writes, setCached: (next: typeof cached) => (cached = next) };
}

function tmap(
  implementation: (option: TmapPedestrianSearchOption) => Promise<RouteCandidate> = async (
    option,
  ) => candidates[option],
) {
  const order: string[] = [];
  const client: TmapPedestrianRoutingClient = {
    route: vi.fn(async ({ searchOption }) => {
      order.push(searchOption);
      return implementation(searchOption);
    }),
  };
  return { client, order };
}

function dependencies(
  routingRepository: RoutingRepository,
  tmapClient: TmapPedestrianRoutingClient,
): RoutingServiceDependencies {
  return {
    repository: routingRepository,
    tmapClient,
    now: () => new Date("2026-08-24T03:02:00.000Z"),
  };
}

describe("shade routing service", () => {
  it("rejects an invalid start, destination, shelter or time before any dependency call", async () => {
    const store = repository();
    const provider = tmap();

    await expect(
      planShadeRoute(
        { ...input, start: [999, 35.87], shelterId: "raw address", at: "not-a-time" },
        dependencies(store.value, provider.client),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(store.value.getSpatialVersion).not.toHaveBeenCalled();
    expect(provider.client.route).not.toHaveBeenCalled();
  });

  it("requests option 30 first, generates at most three candidates, and retains option provenance", async () => {
    const store = repository();
    const provider = tmap();

    const result = await planShadeRoute(input, dependencies(store.value, provider.client));

    expect(provider.order).toEqual(["30", "10", "0"]);
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((route) => route.searchOption)).toEqual(["30", "10", "0"]);
    expect(result.candidates.every((route) => route.source === "TMAP")).toBe(true);
    expect(RoutePlanDtoSchema.safeParse(result).success).toBe(true);
  });

  it("computes daylight building shade, rest evidence and the weighted ranking", async () => {
    const store = repository({
      getSpatialContext: vi.fn(async (route): Promise<RouteSpatialContext> => ({
        ...completeContext,
        buildings: route[0]?.[1] === 35.87 ? [building] : [],
        restSpots: route[0]?.[1] === 35.87 ? completeContext.restSpots : [],
      })),
    });
    const provider = tmap();

    const result = await planShadeRoute(input, dependencies(store.value, provider.client));
    const preferred = result.candidates.find((route) => route.searchOption === "30");

    expect(preferred?.analysisState).toBe("COMPLETE");
    expect(preferred?.shadeRatio).toBeGreaterThan(0);
    expect(preferred?.shadows).toEqual([
      expect.objectContaining({ type: expect.stringMatching(/^(?:Polygon|MultiPolygon)$/u) }),
    ]);
    expect(preferred?.rest?.matchedRestSpots).toBe(1);
    expect(preferred?.score).toBeTypeOf("number");
    expect(result.selectedCandidateId).toBe(preferred?.id);
    expect(result.claim).toBe("DEMO_ACCESSIBILITY_CANDIDATE");
    expect(store.value.getSpatialContext).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Number),
    );
    expect(JSON.stringify(result)).not.toMatch(/VERIFIED_SAFE|무계단 보장|안전 경로/u);
  });

  it("excludes only confirmed intersecting barriers and selects another analyzed candidate", async () => {
    const store = repository({
      getSpatialContext: vi.fn(async (route): Promise<RouteSpatialContext> => ({
        ...completeContext,
        barriers:
          route[0]?.[1] === 35.87
            ? [
                {
                  id: "00000000-0000-4000-8000-000000000003",
                  barrierType: "STAIRS" as const,
                  slopePercent: null,
                  geometry: {
                    type: "LineString" as const,
                    coordinates: [[128.602, 35.869] as const, [128.602, 35.871] as const],
                  },
                  confidence: "VERIFIED_SOURCE" as const,
                  coverage: "DAEGU_ALL" as const,
                  unknownReason: null,
                },
              ]
            : [],
      })),
    });
    const provider = tmap();

    const result = await planShadeRoute(input, dependencies(store.value, provider.client));

    expect(result.candidates.find((route) => route.searchOption === "30")).toMatchObject({
      excluded: true,
      exclusionReasons: ["CONFIRMED_STAIRS"],
    });
    expect(result.selectedCandidateId).not.toBe(candidates["30"].id);
  });

  it("uses the shortest non-excluded candidate after sunset and skips shade geometry", async () => {
    const store = repository();
    const provider = tmap();

    const result = await planShadeRoute(
      { ...input, at: "2026-08-24T00:00:00+09:00" },
      dependencies(store.value, provider.client),
    );

    expect(result.selectedCandidateId).toBe(candidates["30"].id);
    expect(result.banner).toBe("일몰 후 — 최단 경로로 안내합니다");
    expect(result.candidates.every((route) => route.shadeRatio === null)).toBe(true);
    expect(result.candidates.every((route) => route.segments.length === 0)).toBe(true);
    expect(result.candidates.every((route) => route.shadows.length === 0)).toBe(true);
    expect(store.value.getSpatialContext).toHaveBeenCalledWith(expect.any(Array), 0);
  });

  it("returns a safe failure when mandatory option 30 fails and does not request alternatives", async () => {
    const store = repository();
    const provider = tmap(async () => {
      throw new Error("provider secret and appKey");
    });

    const result = await planShadeRoute(input, dependencies(store.value, provider.client));

    expect(result).toMatchObject({
      state: "FAILED",
      selectedCandidateId: null,
      candidates: [],
      failure: { code: "TMAP_REQUIRED_ROUTE_UNAVAILABLE", retryable: true },
    });
    expect(provider.order).toEqual(["30"]);
    expect(JSON.stringify(result)).not.toMatch(/provider secret|appKey/u);
  });

  it("marks alternative-provider and spatial-data gaps partial instead of silently claiming success", async () => {
    const store = repository({
      getSpatialContext: vi.fn().mockRejectedValue(new Error("raw PostGIS diagnostics")),
    });
    const provider = tmap(async (option) => {
      if (option !== "30") throw new Error("quota raw response");
      return candidates[option];
    });

    const result = await planShadeRoute(input, dependencies(store.value, provider.client));

    expect(result.state).toBe("PARTIAL");
    expect(result.warnings).toEqual(
      expect.arrayContaining(["TMAP_ALTERNATIVE_UNAVAILABLE", "SPATIAL_CONTEXT_UNAVAILABLE"]),
    );
    expect(result.selectedCandidateId).toBe(candidates["30"].id);
    expect(result.candidates[0]).toMatchObject({
      analysisState: "SPATIAL_UNAVAILABLE",
      shadeRatio: null,
      score: null,
    });
    expect(JSON.stringify(result)).not.toMatch(/PostGIS|quota raw/u);
  });

  it("keeps TMAP distance and geometry but marks analysis unavailable when no spatial release is active", async () => {
    const store = repository({
      getSpatialVersion: vi.fn().mockResolvedValue("NO_ACTIVE_RELEASE"),
      getSpatialContext: vi.fn().mockRejectedValue(new Error("must not query without a release")),
    });
    const provider = tmap();

    const result = await planShadeRoute(input, dependencies(store.value, provider.client));

    expect(store.value.getSpatialContext).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      state: "PARTIAL",
      spatialVersion: "NO_ACTIVE_RELEASE",
      selectedCandidateId: candidates["30"].id,
      badge: "TMAP 보행 경로 후보",
      claim: "TMAP_PEDESTRIAN_CANDIDATE",
    });
    expect(result.notice).toContain("공간자료가 없어");
    expect(result.notice).not.toContain("공개 공간자료를 반영한 후보");
    expect(result.warnings).toEqual(
      expect.arrayContaining(["SPATIAL_VERSION_UNAVAILABLE", "SPATIAL_CONTEXT_UNAVAILABLE"]),
    );
    expect(result.candidates).toHaveLength(3);
    expect(
      result.candidates.every(
        (route) =>
          route.analysisState === "SPATIAL_UNAVAILABLE" &&
          route.shadeRatio === null &&
          route.rest === null &&
          route.score === null,
      ),
    ).toBe(true);
    expect(result.candidates[0]).toMatchObject({
      coordinates: candidates["30"].coordinates,
      distanceM: candidates["30"].distanceM,
      durationSec: candidates["30"].elderDurationSec,
      provenance: { spatialVersion: "NO_ACTIVE_RELEASE" },
    });
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]?.spatialVersion).toBe("NO_ACTIVE_RELEASE");

    const cachedProvider = tmap(async () => {
      throw new Error("must not call TMAP for cached no-release plan");
    });
    const cached = await planShadeRoute(input, dependencies(store.value, cachedProvider.client));

    expect(cached.source).toBe("CACHE");
    expect(cached.spatialVersion).toBe("NO_ACTIVE_RELEASE");
    expect(cachedProvider.client.route).not.toHaveBeenCalled();
  });

  it("does not interpret an empty spatial context as zero-percent shade or complete accessibility", async () => {
    const emptyContext: RouteSpatialContext = {
      buildings: [],
      restSpots: [],
      barriers: [],
      spatialVersion: completeContext.spatialVersion,
    };
    const store = repository({
      getSpatialContext: vi.fn().mockResolvedValue(emptyContext),
    });

    const result = await planShadeRoute(input, dependencies(store.value, tmap().client));

    expect(result.state).toBe("PARTIAL");
    expect(result.warnings).toContain("SPATIAL_CONTEXT_UNAVAILABLE");
    expect(
      result.candidates.every(
        (route) =>
          route.analysisState === "SPATIAL_UNAVAILABLE" &&
          route.shadeRatio === null &&
          route.shadeDistanceM === null &&
          route.sunDistanceM === null &&
          route.rest === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('"shadeRatio":0');
  });

  it("reads a validated cache before TMAP and writes live plans with a ten-minute TTL", async () => {
    const store = repository();
    const provider = tmap();
    const deps = dependencies(store.value, provider.client);

    const live = await planShadeRoute(input, deps);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({
      destinationShelterId: "DG-0001",
      expiresAt: "2026-08-24T03:12:00.000Z",
    });
    expect(store.writes[0]?.cacheKey).toMatch(/^[0-9a-f]{64}$/u);

    const cachedProvider = tmap(async () => {
      throw new Error("must not call TMAP on a cache hit");
    });
    const cached = await planShadeRoute(input, dependencies(store.value, cachedProvider.client));

    expect(cached.source).toBe("CACHE");
    expect(cached.selectedCandidateId).toBe(live.selectedCandidateId);
    expect(cachedProvider.client.route).not.toHaveBeenCalled();
  });

  it("ignores an invalid cached payload, computes live, and exposes only a cache warning", async () => {
    const store = repository({
      readCache: vi.fn().mockResolvedValue({
        result: { state: "READY", serverSecret: "no" },
        expiresAt: "2026-08-24T03:12:00.000Z",
      }),
    });
    const provider = tmap();

    const result = await planShadeRoute(input, dependencies(store.value, provider.client));

    expect(provider.client.route).toHaveBeenCalled();
    expect(result.warnings).toContain("CACHE_INVALID");
    expect(JSON.stringify(result)).not.toContain("serverSecret");
  });
});
