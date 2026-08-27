import { describe, expect, it } from "vitest";

import { calculateSunState, shadowLengthMeters } from "./sun";

describe("sun position", () => {
  it("uses the instant represented by a KST timestamp", () => {
    const daylight = calculateSunState(new Date("2026-08-23T13:00:00+09:00"), 35.8714, 128.6014);
    expect(daylight.kind).toBe("DAYLIGHT");
    if (daylight.kind === "DAYLIGHT") expect(daylight.altitudeRad).toBeGreaterThan(0);
  });

  it("treats altitude at or below zero as after sunset", () => {
    expect(calculateSunState(new Date("2026-08-23T23:00:00+09:00"), 35.8714, 128.6014)).toEqual({
      kind: "AFTER_SUNSET",
    });
  });

  it("projects longer shadows as the sun gets lower", () => {
    expect(shadowLengthMeters(10, Math.PI / 6)).toBeCloseTo(17.3205, 3);
    expect(shadowLengthMeters(10, Math.PI / 12)).toBeGreaterThan(
      shadowLengthMeters(10, Math.PI / 4),
    );
  });
});
