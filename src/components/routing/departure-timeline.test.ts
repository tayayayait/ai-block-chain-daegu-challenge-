import { describe, expect, it } from "vitest";

import { getDepartureTimelineFrame } from "./departure-timeline";
import type {
  DepartureComparisonSlotUiDto,
  DepartureComparisonUiDto,
  RoutePlanUiDto,
} from "./route-ui-dto";

describe("departure timeline interpolation", () => {
  it("interpolates metrics and matching shadow vertices for every minute", () => {
    const comparison = createComparison();

    const frame = getDepartureTimelineFrame(comparison, 15);

    expect(frame).toMatchObject({
      offsetMinutes: 15,
      departureAt: "2026-08-26T06:15:00.000Z",
      feelsLikeC: 35.75,
      shadePercent: 56.5,
      directSunMinutes: 16,
      walkingMinutes: 24,
      additionalWalkingMinutes: 0,
      interpolated: true,
    });
    expect(frame.plan.shadowCalculatedAt).toBe("2026-08-26T06:15:00.000Z");
    expect(frame.plan.candidates[0]?.shadeRatio).toBeCloseTo(0.565);
    expect(frame.plan.candidates[0]?.shadows[0]).toMatchObject({
      type: "Polygon",
      coordinates: [
        [
          [128.602, 35.872],
          [128.603, 35.872],
          [128.603, 35.873],
          [128.602, 35.872],
        ],
      ],
    });
  });

  it("preserves fractional minutes for continuous playback frames", () => {
    const comparison = createComparison();

    const frame = getDepartureTimelineFrame(comparison, 15.5);

    expect(frame.offsetMinutes).toBe(15.5);
    expect(frame.departureAt).toBe("2026-08-26T06:15:30.000Z");
    expect(frame.shadePercent).toBeCloseTo(56.65);
    expect(frame.plan.shadowCalculatedAt).toBe("2026-08-26T06:15:30.000Z");
  });

  it("clamps requested time to the current-to-one-hour playback window", () => {
    const comparison = createComparison();

    expect(getDepartureTimelineFrame(comparison, -4).offsetMinutes).toBe(0);
    const finalFrame = getDepartureTimelineFrame(comparison, 95);
    expect(finalFrame.offsetMinutes).toBe(60);
    expect(finalFrame.departureAt).toBe("2026-08-26T07:00:00.000Z");
    expect(finalFrame.feelsLikeC).toBe(34.1);
  });
});

function createComparison(): DepartureComparisonUiDto {
  return {
    recommendedOffsetMinutes: 60,
    forecastSource: "KMA_VILLAGE_FORECAST",
    slots: [
      slot(0, 36.2, 52, 18, [128.601, 35.871]),
      slot(30, 35.3, 61, 14, [128.603, 35.873]),
      slot(60, 34.1, 74, 9, [128.605, 35.875]),
    ],
  };
}

function slot(
  offsetMinutes: 0 | 30 | 60,
  feelsLikeC: number,
  shadePercent: number,
  directSunMinutes: number,
  origin: readonly [number, number],
): DepartureComparisonSlotUiDto {
  const departureAt = new Date(
    Date.parse("2026-08-26T06:00:00.000Z") + offsetMinutes * 60_000,
  ).toISOString();
  const [longitude, latitude] = origin;
  return {
    offsetMinutes,
    label: offsetMinutes === 0 ? "지금 출발" : offsetMinutes === 30 ? "30분 후" : "1시간 후",
    departureAt,
    feelsLikeC,
    forecastAt: departureAt,
    forecastInterpolated: offsetMinutes === 30,
    shadePercent,
    directSunMinutes,
    walkingMinutes: offsetMinutes === 60 ? 25 : 24,
    additionalWalkingMinutes: offsetMinutes === 60 ? 1 : 0,
    plan: plan(departureAt, shadePercent, [longitude, latitude]),
  };
}

function plan(
  shadowCalculatedAt: string,
  shadePercent: number,
  [longitude, latitude]: readonly [number, number],
): RoutePlanUiDto {
  return {
    destinationName: "중구 무더위쉼터",
    afterSunset: false,
    shadowCalculatedAt,
    naverMapUrl: null,
    candidates: [
      {
        id: "route-1",
        label: "후보 1",
        distanceM: 520,
        spatialAnalysisAvailable: true,
        shadeRatio: shadePercent / 100,
        shadows: [
          {
            type: "Polygon",
            coordinates: [
              [
                [longitude, latitude],
                [longitude + 0.001, latitude],
                [longitude + 0.001, latitude + 0.001],
                [longitude, latitude],
              ],
            ],
          },
        ],
        segments: [],
        restSpots: [],
        warnings: [],
      },
    ],
  };
}
