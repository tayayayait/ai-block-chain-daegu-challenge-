import { describe, expect, it, vi } from "vitest";

import type { VilageForecastSlot } from "@/integrations/kma/weather";
import {
  createMemoizedTmapClient,
  planDepartureComparison,
  type DeparturePlannerDependencies,
} from "./departure-planner.server";
import type { RoutePlanDto, ShadeRouteRequest } from "./service.server";
import type { RouteCandidate } from "./types";

const baseTime = new Date("2026-08-26T06:00:00.000Z");
const destination = {
  name: "중구 무더위쉼터",
  longitude: 128.6063,
  latitude: 35.8707,
};

describe("departure comparison planner", () => {
  it("plans three anchors through one hour, fetches forecast once, and recommends the lowest burden", async () => {
    const plannedAt: string[] = [];
    const getForecast = vi.fn(async (): Promise<readonly VilageForecastSlot[]> => [
      forecast("2026-08-26T15:00:00+09:00", 36, 60),
      forecast("2026-08-26T16:00:00+09:00", 34, 60),
      forecast("2026-08-26T17:00:00+09:00", 35, 60),
    ]);
    const planRoute = vi.fn(async (input: ShadeRouteRequest) => {
      const at = new Date(input.at).toISOString();
      plannedAt.push(at);
      const index = [0, 30, 60].indexOf(Math.round((Date.parse(at) - baseTime.getTime()) / 60_000));
      return routePlan(at, [0.52, 0.61, 0.74][index] ?? 0.5, [24, 24, 25][index] ?? 24);
    });
    const dependencies: DeparturePlannerDependencies = {
      now: () => baseTime,
      getForecast,
      planRoute,
    };

    const result = await planDepartureComparison(
      {
        start: [128.601, 35.871],
        destinationPosition: [destination.longitude, destination.latitude],
        shelterId: "DG-0009",
        destination,
      },
      dependencies,
    );

    expect(plannedAt).toEqual([
      "2026-08-26T06:00:00.000Z",
      "2026-08-26T06:30:00.000Z",
      "2026-08-26T07:00:00.000Z",
    ]);
    expect(getForecast).toHaveBeenCalledOnce();
    expect(getForecast).toHaveBeenCalledWith({ nx: 89, ny: 91, at: baseTime.toISOString() });
    expect(result.recommendedOffsetMinutes).toBe(60);
    expect(result.forecastSource).toBe("KMA_VILLAGE_FORECAST");
    expect(result.slots).toHaveLength(3);
    expect(result.slots[2]).toMatchObject({
      offsetMinutes: 60,
      shadePercent: 74,
      directSunMinutes: 7,
      walkingMinutes: 25,
      additionalWalkingMinutes: 1,
      forecastInterpolated: false,
    });
  });

  it("continues with sun and duration metrics when the forecast provider fails", async () => {
    const result = await planDepartureComparison(
      {
        start: [128.601, 35.871],
        destinationPosition: [destination.longitude, destination.latitude],
        shelterId: "DG-0009",
        destination,
      },
      {
        now: () => baseTime,
        getForecast: vi.fn().mockRejectedValue(new Error("provider unavailable")),
        planRoute: async (input) => routePlan(new Date(input.at).toISOString(), 0.7, 25),
      },
    );

    expect(result.forecastSource).toBe("UNAVAILABLE");
    expect(result.slots.every((slot) => slot.feelsLikeC === null)).toBe(true);
    expect(result.slots).toHaveLength(3);
  });

  it("deduplicates concurrent TMAP requests for the same route and option", async () => {
    const candidate = tmapCandidate();
    const upstream = { route: vi.fn(async () => candidate) };
    const memoized = createMemoizedTmapClient(upstream);
    const input = {
      start: [128.601, 35.871] as const,
      destination: [128.6063, 35.8707] as const,
      searchOption: "30" as const,
    };

    const [first, second] = await Promise.all([memoized.route(input), memoized.route(input)]);

    expect(first).toBe(candidate);
    expect(second).toBe(candidate);
    expect(upstream.route).toHaveBeenCalledOnce();
  });
});

function forecast(
  forecastAt: string,
  airTemperatureC: number,
  relativeHumidityPct: number,
): VilageForecastSlot {
  return { forecastAt, airTemperatureC, relativeHumidityPct, grid: { nx: 89, ny: 91 } };
}

function routePlan(at: string, shadeRatio: number, walkingMinutes: number): RoutePlanDto {
  const durationSec = walkingMinutes * 60;
  const preferred = routeCandidateDto("preferred", 900, durationSec, shadeRatio);
  const shortest = routeCandidateDto("shortest", 860, Math.max(60, durationSec - 60), 0.2);
  return {
    state: "READY",
    source: "LIVE",
    selectedCandidateId: preferred.id,
    candidates: [preferred, shortest],
    banner: null,
    badge: "시연용 접근성 우선 후보",
    notice: "현장을 확인하세요.",
    claim: "DEMO_ACCESSIBILITY_CANDIDATE",
    warnings: [],
    failure: null,
    spatialVersion: "BARRIER:v1|BUILDING:v1|REST_SPOT:v1",
    shadowCalculatedAt: at,
    generatedAt: baseTime.toISOString(),
    expiresAt: new Date(baseTime.getTime() + 600_000).toISOString(),
  };
}

function routeCandidateDto(id: string, distanceM: number, durationSec: number, shadeRatio: number) {
  return {
    id,
    source: "TMAP" as const,
    searchOption: id === "preferred" ? ("30" as const) : ("0" as const),
    coordinates: [[128.601, 35.871] as [number, number], [128.6063, 35.8707] as [number, number]],
    distanceM,
    durationSec,
    providerDurationSec: durationSec,
    analysisState: "COMPLETE" as const,
    shadeRatio,
    shadeDistanceM: distanceM * shadeRatio,
    sunDistanceM: distanceM * (1 - shadeRatio),
    segments: [
      {
        exposure: "SHADE" as const,
        coordinates: [
          [128.601, 35.871] as [number, number],
          [128.6063, 35.8707] as [number, number],
        ],
        distanceM,
      },
    ],
    shadows: [],
    score: 0.5,
    excluded: false,
    exclusionReasons: [],
    warnings: [],
    unknownReasons: [],
    rest: { matchedRestSpots: 0, requiredStops: 0, restSpotDensity: 0, maximumGapM: distanceM },
    provenance: {
      spatialVersion: "BARRIER:v1|BUILDING:v1|REST_SPOT:v1",
      coverage: ["DAEGU_ALL" as const],
      confidence: ["VERIFIED_SOURCE" as const],
      unknownReasons: [],
    },
  };
}

function tmapCandidate(): RouteCandidate {
  return {
    id: "candidate-30",
    source: "TMAP",
    searchOption: "30",
    coordinates: [
      [128.601, 35.871],
      [128.6063, 35.8707],
    ],
    distanceM: 900,
    elderDurationSec: 1_200,
    providerDurationSec: 1_000,
  };
}
