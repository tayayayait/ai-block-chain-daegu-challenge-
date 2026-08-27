import { describe, expect, it } from "vitest";

import { createRouteCacheKey, quantizeCoordinate, tenMinuteSunBucket } from "./cache-key";

describe("route cache key", () => {
  it("quantizes departure and includes destination, ten-minute sun bucket and spatial version", () => {
    const key = createRouteCacheKey({
      departure: [128.601234, 35.871234],
      destinationId: "SHELTER-001",
      at: new Date("2026-08-23T13:07:59+09:00"),
      spatialVersion: "2026-08-23.v3",
    });

    expect(key).toMatch(/^shade-route-v2:/u);
    expect(key).toContain(quantizeCoordinate([128.601234, 35.871234]).join(","));
    expect(key).toContain("SHELTER-001");
    expect(key).toContain(tenMinuteSunBucket(new Date("2026-08-23T13:07:59+09:00")));
    expect(key).toContain("2026-08-23.v3");
  });

  it("returns the same key inside a cell and bucket, but changes at their boundaries", () => {
    const base = {
      destinationId: "S1",
      spatialVersion: "v1",
      at: new Date("2026-08-23T13:01:00+09:00"),
    };
    expect(createRouteCacheKey({ ...base, departure: [128.601001, 35.871001] })).toBe(
      createRouteCacheKey({ ...base, departure: [128.601004, 35.871004] }),
    );
    expect(createRouteCacheKey({ ...base, departure: [128.601001, 35.871001] })).not.toBe(
      createRouteCacheKey({
        ...base,
        departure: [128.602001, 35.872001],
        at: new Date("2026-08-23T13:11:00+09:00"),
      }),
    );
  });
});
