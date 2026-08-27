import { describe, expect, it } from "vitest";

import type { RouteCandidateUiDto } from "./route-ui-dto";
import {
  ACCESSIBILITY_CANDIDATE_NOTICE,
  summarizeRouteCandidate,
  warningMessage,
} from "./route-presentation";

const candidate: RouteCandidateUiDto = {
  id: "route-a",
  label: "후보 1",
  distanceM: 630,
  spatialAnalysisAvailable: true,
  shadeRatio: 0.68,
  shadows: [],
  segments: [
    {
      id: "shade-1",
      exposure: "SHADE",
      distanceM: 428,
      coordinates: [
        [128.6, 35.87],
        [128.603, 35.871],
      ],
    },
    {
      id: "sun-1",
      exposure: "SUN",
      distanceM: 102,
      coordinates: [
        [128.603, 35.871],
        [128.605, 35.872],
      ],
    },
    {
      id: "sun-2",
      exposure: "SUN",
      distanceM: 100,
      coordinates: [
        [128.605, 35.872],
        [128.607, 35.873],
      ],
    },
  ],
  restSpots: [{ id: "rest-1", label: "공원 벤치", distanceAlongRouteM: 280 }],
  warnings: ["BARRIER_COVERAGE_PARTIAL", "REST_GAP_OVER_300M"],
};

describe("route presentation", () => {
  it("recalculates walking time at 0.75m/s instead of trusting a provider duration", () => {
    const summary = summarizeRouteCandidate(candidate);

    expect(summary.elderDurationSec).toBe(840);
    expect(summary.walkingMinutes).toBe(14);
    expect(summary.distanceLabel).toBe("630m");
  });

  it("counts and totals sunlight segments while preserving the shade ratio", () => {
    const summary = summarizeRouteCandidate(candidate);

    expect(summary.shadePercent).toBe(68);
    expect(summary.sunSegmentCount).toBe(2);
    expect(summary.sunDistanceM).toBe(202);
    expect(summary.restSpotCount).toBe(1);
  });

  it("uses fixed uncertainty copy and never makes prohibited guarantees", () => {
    const copy = [
      ACCESSIBILITY_CANDIDATE_NOTICE,
      warningMessage("BARRIER_EVIDENCE_UNCERTAIN"),
      warningMessage("BARRIER_COVERAGE_PARTIAL"),
      warningMessage("REST_GAP_OVER_300M"),
      warningMessage("REST_COVERAGE_PARTIAL"),
    ].join(" ");

    expect(copy).toContain("미등록 계단·급경사·휴식시설 운영 여부는 보장하지 않으므로");
    expect(copy).not.toContain("안전 경로");
    expect(copy).not.toContain("무계단 보장");
    expect(copy).not.toContain("경사 5% 이하");
    expect(copy).not.toContain("300m마다 휴식 가능");
  });

  it("presents missing spatial evidence as unavailable instead of zero-percent shade", () => {
    const summary = summarizeRouteCandidate({
      ...candidate,
      spatialAnalysisAvailable: false,
      shadeRatio: null,
      segments: [],
      restSpots: [],
      warnings: [],
    });

    expect(summary.shadePercent).toBeNull();
    expect(summary.spatialAnalysisAvailable).toBe(false);
    expect(ACCESSIBILITY_CANDIDATE_NOTICE).toContain("공간자료가 확보된 범위에서만");
    expect(ACCESSIBILITY_CANDIDATE_NOTICE).not.toContain("공개 공간자료를 반영한 후보");
  });
});
