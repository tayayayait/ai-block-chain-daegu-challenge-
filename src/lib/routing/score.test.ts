import { describe, expect, it } from "vitest";

import { rankRoutes, selectRoutePlan } from "./score";

const candidates = [
  {
    id: "shade",
    durationSec: 1_200,
    distanceM: 900,
    shadeRatio: 0.8,
    restSpotDensity: 0.5,
    excluded: false,
  },
  {
    id: "fast",
    durationSec: 800,
    distanceM: 600,
    shadeRatio: 0.2,
    restSpotDensity: 1,
    excluded: false,
  },
] as const;

describe("route scoring", () => {
  it("uses exactly the 0.60, 0.25 and 0.15 weights", () => {
    const ranked = rankRoutes(candidates);
    expect(ranked.find((route) => route.id === "shade")?.score).toBeCloseTo(0.555);
    expect(ranked.find((route) => route.id === "fast")?.score).toBeCloseTo(0.52);
    expect(ranked[0]?.id).toBe("shade");
  });

  it("breaks equal scores deterministically by duration, distance, then id", () => {
    const tied = [
      {
        id: "b",
        durationSec: 900,
        distanceM: 700,
        shadeRatio: 0.5,
        restSpotDensity: 0.5,
        excluded: false,
      },
      {
        id: "a",
        durationSec: 900,
        distanceM: 700,
        shadeRatio: 0.5,
        restSpotDensity: 0.5,
        excluded: false,
      },
    ] as const;
    expect(rankRoutes(tied).map((route) => route.id)).toEqual(["a", "b"]);
    expect(rankRoutes([...tied].reverse()).map((route) => route.id)).toEqual(["a", "b"]);
  });

  it("after sunset selects the shortest non-excluded route and includes both notices", () => {
    const plan = selectRoutePlan(
      [
        ...candidates,
        {
          id: "blocked",
          durationSec: 500,
          distanceM: 400,
          shadeRatio: 1,
          restSpotDensity: 1,
          excluded: true,
        },
      ],
      { kind: "AFTER_SUNSET" },
    );
    expect(plan.selected.id).toBe("fast");
    expect(plan.ranked[0]?.id).toBe("fast");
    expect(plan.banner).toBe("일몰 후 — 최단 경로로 안내합니다");
    expect(plan.notice).toContain("미등록 계단");
    expect(plan.claim).toBe("DEMO_ACCESSIBILITY_CANDIDATE");
  });

  it.each([
    { ...candidates[0], shadeRatio: Number.NaN },
    { ...candidates[0], shadeRatio: 1.1 },
    { ...candidates[0], restSpotDensity: -0.1 },
    { ...candidates[0], durationSec: -1 },
  ])("rejects invalid score input %#", (candidate) => {
    expect(() => rankRoutes([candidate])).toThrow(RangeError);
  });
});
