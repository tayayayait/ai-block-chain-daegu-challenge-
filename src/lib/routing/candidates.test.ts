import { describe, expect, it } from "vitest";

import { routeFixture } from "./fixtures/routes";
import {
  elderWalkingDurationSec,
  geometryOverlapRatio,
  normalizeRouteCandidates,
} from "./candidates";

describe("route candidate normalization", () => {
  it("recomputes time at 0.75 metres per second and rounds up", () => {
    expect(elderWalkingDurationSec(750)).toBe(1_000);
    expect(elderWalkingDurationSec(1)).toBe(2);
  });

  it("removes a route whose geometry overlaps another by at least 95%", () => {
    const preferred = routeFixture({
      id: "stairs-excluded",
      searchOption: "30",
      coordinates: [
        [128.6, 35.87],
        [128.61, 35.87],
      ],
    });
    const duplicate = routeFixture({
      id: "recommended-copy",
      searchOption: "0",
      coordinates: [
        [128.6, 35.87],
        [128.61, 35.87],
      ],
    });

    expect(
      geometryOverlapRatio(preferred.coordinates, duplicate.coordinates),
    ).toBeGreaterThanOrEqual(0.95);
    expect(normalizeRouteCandidates([duplicate, preferred]).map((route) => route.id)).toEqual([
      "stairs-excluded",
    ]);
  });

  it("keeps at most three distinct candidates in deterministic option order", () => {
    const candidates = [
      routeFixture({
        id: "boulevard",
        searchOption: "4",
        coordinates: [
          [128.6, 35.87],
          [128.61, 35.871],
        ],
      }),
      routeFixture({
        id: "shortest",
        searchOption: "10",
        coordinates: [
          [128.6, 35.87],
          [128.61, 35.869],
        ],
      }),
      routeFixture({
        id: "recommended",
        searchOption: "0",
        coordinates: [
          [128.6, 35.87],
          [128.61, 35.868],
        ],
      }),
      routeFixture({
        id: "stairs-excluded",
        searchOption: "30",
        coordinates: [
          [128.6, 35.87],
          [128.61, 35.872],
        ],
      }),
    ];

    const expected = ["stairs-excluded", "shortest", "recommended"];
    expect(normalizeRouteCandidates(candidates).map((route) => route.id)).toEqual(expected);
    expect(normalizeRouteCandidates([...candidates].reverse()).map((route) => route.id)).toEqual(
      expected,
    );
  });
});
