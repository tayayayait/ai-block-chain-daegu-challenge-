import { describe, expect, it } from "vitest";

import type { RoutePlanDto } from "./service.server";
import { toRoutePlanUiDto } from "./public-plan.server";

const basePlan = (overrides: Partial<RoutePlanDto> = {}): RoutePlanDto => ({
  state: "READY",
  source: "LIVE",
  selectedCandidateId: "route-1",
  candidates: [
    {
      id: "route-1",
      source: "TMAP",
      searchOption: "30",
      coordinates: [
        [128.601, 35.871],
        [128.6063, 35.8707],
      ],
      distanceM: 520,
      durationSec: 694,
      providerDurationSec: 620,
      analysisState: "COMPLETE",
      shadeRatio: 0.68,
      shadeDistanceM: 354,
      sunDistanceM: 166,
      segments: [
        {
          exposure: "SHADE",
          coordinates: [
            [128.601, 35.871],
            [128.603, 35.871],
          ],
          distanceM: 354,
        },
        {
          exposure: "SUN",
          coordinates: [
            [128.603, 35.871],
            [128.6063, 35.8707],
          ],
          distanceM: 166,
        },
      ],
      shadows: [
        {
          type: "Polygon",
          coordinates: [
            [
              [128.601, 35.87],
              [128.603, 35.87],
              [128.603, 35.872],
              [128.601, 35.87],
            ],
          ],
        },
      ],
      score: 0.72,
      excluded: false,
      exclusionReasons: [],
      warnings: ["REST_GAP_OVER_300M"],
      unknownReasons: [],
      rest: { matchedRestSpots: 0, requiredStops: 1, restSpotDensity: 0, maximumGapM: 520 },
      provenance: {
        spatialVersion: "BUILDING:2026-08-23",
        coverage: ["DAEGU_ALL"],
        confidence: ["DERIVED"],
        unknownReasons: [],
      },
    },
  ],
  banner: null,
  badge: "시연용 접근성 우선 후보",
  notice: "현장을 확인하세요.",
  claim: "DEMO_ACCESSIBILITY_CANDIDATE",
  warnings: [],
  failure: null,
  spatialVersion: "BUILDING:2026-08-23",
  shadowCalculatedAt: "2026-08-23T11:58:00.000Z",
  generatedAt: "2026-08-23T12:00:00.000Z",
  expiresAt: "2026-08-23T12:10:00.000Z",
  ...overrides,
});

describe("public route-plan mapping", () => {
  it("removes excluded candidates and provider/internal metadata", () => {
    const plan = basePlan();
    const dto = toRoutePlanUiDto(plan, {
      name: "iM뱅크 중구청지점",
      longitude: 128.6063,
      latitude: 35.8707,
    });

    expect(dto.destinationName).toBe("iM뱅크 중구청지점");
    expect(dto.candidates[0]).toMatchObject({
      id: "route-1",
      label: "후보 1",
      shadeRatio: 0.68,
      warnings: ["REST_GAP_OVER_300M"],
      shadows: [expect.objectContaining({ type: "Polygon" })],
    });
    expect(dto.shadowCalculatedAt).toBe("2026-08-23T11:58:00.000Z");
    expect(JSON.stringify(dto)).not.toMatch(/searchOption|providerDuration|spatialVersion|score/iu);
    expect(dto.naverMapUrl).toMatch(/^https:\/\/map\.naver\.com\/p\/directions\//u);
  });

  it("uses a neutral full-route segment after sunset without claiming shade or sunlight", () => {
    const daylight = basePlan();
    const route = daylight.candidates[0]!;
    const plan = basePlan({
      banner: "일몰 후 — 최단 경로로 안내합니다",
      candidates: [{ ...route, shadeRatio: null, segments: [] }],
    });

    const dto = toRoutePlanUiDto(plan, {
      name: "쉼터",
      longitude: 128.6063,
      latitude: 35.8707,
    });

    expect(dto.afterSunset).toBe(true);
    expect(dto.shadowCalculatedAt).toBeNull();
    expect(dto.candidates[0]?.shadows).toEqual([]);
    expect(dto.candidates[0]?.segments).toEqual([
      expect.objectContaining({ exposure: "NEUTRAL", coordinates: route.coordinates }),
    ]);
  });

  it("preserves an unavailable spatial-analysis state in the browser-safe DTO", () => {
    const route = basePlan().candidates[0]!;
    const plan = basePlan({
      state: "PARTIAL",
      candidates: [
        {
          ...route,
          analysisState: "SPATIAL_UNAVAILABLE",
          shadeRatio: null,
          shadeDistanceM: null,
          sunDistanceM: null,
          segments: [],
          score: null,
          rest: null,
        },
      ],
    });

    const dto = toRoutePlanUiDto(plan, {
      name: "쉼터",
      longitude: 128.6063,
      latitude: 35.8707,
    });

    expect(dto.candidates[0]).toMatchObject({
      spatialAnalysisAvailable: false,
      shadeRatio: null,
      segments: [expect.objectContaining({ exposure: "NEUTRAL", coordinates: route.coordinates })],
    });
  });

  it("rejects a failed or candidate-less server plan", () => {
    expect(() =>
      toRoutePlanUiDto(basePlan({ state: "FAILED", candidates: [], selectedCandidateId: null }), {
        name: "쉼터",
        longitude: 128.6063,
        latitude: 35.8707,
      }),
    ).toThrowError("ROUTE_PLAN_UNAVAILABLE");
  });
});
