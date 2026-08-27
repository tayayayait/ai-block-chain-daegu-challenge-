import { describe, expect, it } from "vitest";

import { toKmaGrid } from "./kma-grid";

describe("KMA DFS Lambert grid conversion", () => {
  it.each([
    { latitude: 37.5665, longitude: 126.978, expected: { nx: 60, ny: 127 } },
    { latitude: 35.8714, longitude: 128.6014, expected: { nx: 89, ny: 91 } },
  ])(
    "converts WGS84 coordinates to the official 5 km grid",
    ({ latitude, longitude, expected }) => {
      expect(toKmaGrid(latitude, longitude)).toEqual(expected);
    },
  );

  it.each([
    [Number.NaN, 128.6],
    [35.8, Number.POSITIVE_INFINITY],
    [-91, 128.6],
    [35.8, 181],
  ])("rejects invalid coordinates (%s, %s)", (latitude, longitude) => {
    expect(() => toKmaGrid(latitude, longitude)).toThrow("Invalid WGS84 coordinate");
  });
});
