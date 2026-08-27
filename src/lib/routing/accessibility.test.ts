import { describe, expect, it } from "vitest";

import { routeFixture } from "./fixtures/routes";
import { assessAccessibility, assessRestStops } from "./accessibility";

describe("accessibility evidence", () => {
  const route = routeFixture({
    id: "candidate",
    coordinates: [
      [128.6, 35.87],
      [128.61, 35.87],
    ],
    distanceM: 900,
  });

  it.each([
    ["STAIRS", null],
    ["STEEP_SLOPE", 5.01],
  ] as const)(
    "excludes confirmed %s evidence that intersects the route",
    (barrierType, slopePercent) => {
      const assessment = assessAccessibility(route, {
        barriers: [
          {
            id: "barrier",
            barrierType,
            slopePercent,
            confidence: barrierType === "STAIRS" ? "VERIFIED_SOURCE" : "DERIVED",
            coverage: "COMMUNITY_PARTIAL",
            unknownReason: null,
            geometry: {
              type: "LineString",
              coordinates: [
                [128.605, 35.869],
                [128.605, 35.871],
              ],
            },
          },
        ],
        restSpots: [],
        restCoverageComplete: false,
      });

      expect(assessment.excluded).toBe(true);
      expect(assessment.exclusionReasons).toContain(
        barrierType === "STAIRS" ? "CONFIRMED_STAIRS" : "CONFIRMED_STEEP_SLOPE",
      );
    },
  );

  it("does not exclude an unconfirmed barrier or a slope at exactly 5 percent", () => {
    const assessment = assessAccessibility(route, {
      barriers: [
        {
          id: "community-stairs",
          barrierType: "STAIRS",
          slopePercent: null,
          confidence: "COMMUNITY",
          coverage: "COMMUNITY_PARTIAL",
          unknownReason: "현장 확인 전",
          geometry: {
            type: "LineString",
            coordinates: [
              [128.605, 35.869],
              [128.605, 35.871],
            ],
          },
        },
        {
          id: "five-percent",
          barrierType: "STEEP_SLOPE",
          slopePercent: 5,
          confidence: "DERIVED",
          coverage: "DAEGU_ALL",
          unknownReason: null,
          geometry: {
            type: "LineString",
            coordinates: [
              [128.606, 35.869],
              [128.606, 35.871],
            ],
          },
        },
      ],
      restSpots: [],
      restCoverageComplete: false,
    });

    expect(assessment.excluded).toBe(false);
    expect(assessment.warnings).toContain("BARRIER_EVIDENCE_UNCERTAIN");
    expect(assessment.safetyClaim).toBe("DEMO_ACCESSIBILITY_CANDIDATE");
    expect(JSON.stringify(assessment)).not.toContain("VERIFIED_SAFE");
  });

  it("warns when a rest interval is over 300 metres and coverage is partial", () => {
    const rest = assessRestStops(
      1_000,
      [
        { id: "r1", distanceAlongRouteM: 200 },
        { id: "r2", distanceAlongRouteM: 520 },
      ],
      false,
    );

    expect(rest.maximumGapM).toBe(480);
    expect(rest.restSpotDensity).toBeCloseTo(2 / 3);
    expect(rest.warnings).toEqual(
      expect.arrayContaining(["REST_GAP_OVER_300M", "REST_COVERAGE_PARTIAL"]),
    );
  });

  it("does not require an intermediate rest stop on a route of 300 metres or less", () => {
    const rest = assessRestStops(280, [], true);

    expect(rest.requiredStops).toBe(0);
    expect(rest.restSpotDensity).toBe(1);
    expect(rest.warnings).not.toContain("REST_GAP_OVER_300M");
  });

  it("does not treat a route wholly inside a polygon hole as a barrier intersection", () => {
    const insideHole = routeFixture({
      id: "inside-hole",
      coordinates: [
        [128.604, 35.87],
        [128.606, 35.87],
      ],
      distanceM: 180,
    });
    const assessment = assessAccessibility(insideHole, {
      barriers: [
        {
          id: "courtyard-barrier",
          barrierType: "STAIRS",
          slopePercent: null,
          confidence: "VERIFIED_SOURCE",
          coverage: "DAEGU_ALL",
          unknownReason: null,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [128.6, 35.868],
                [128.61, 35.868],
                [128.61, 35.872],
                [128.6, 35.872],
                [128.6, 35.868],
              ],
              [
                [128.603, 35.869],
                [128.607, 35.869],
                [128.607, 35.871],
                [128.603, 35.871],
                [128.603, 35.869],
              ],
            ],
          },
        },
      ],
      restSpots: [],
      restCoverageComplete: true,
      barrierCoverageComplete: true,
    });

    expect(assessment.excluded).toBe(false);
  });
});
