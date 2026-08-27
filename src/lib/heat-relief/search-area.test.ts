import { describe, expect, it } from "vitest";

import { DEFAULT_PUBLIC_SHELTER_ORIGIN } from "@/lib/shelters/search-schema";

import { DISTRICT_AREA_MIN_RADIUS_M, heatReliefSearchArea } from "./search-area";

const defaultOrigin = {
  lat: DEFAULT_PUBLIC_SHELTER_ORIGIN.lat,
  lng: DEFAULT_PUBLIC_SHELTER_ORIGIN.lng,
  radius: 500,
} as const;

const suseongShelters = [
  { latitude: 35.858, longitude: 128.63 },
  { latitude: 35.826, longitude: 128.674 },
];

describe("heat-relief search area", () => {
  it("keeps the searched origin when no district is selected", () => {
    expect(
      heatReliefSearchArea({ lat: 35.8571, lng: 128.6221, radius: 1_000 }, suseongShelters),
    ).toEqual({ latitude: 35.8571, longitude: 128.6221, radiusM: 1_000, district: null });
  });

  it("anchors a district browsed from the city centre on that district's own shelters", () => {
    const area = heatReliefSearchArea({ ...defaultOrigin, gu: "수성구" }, suseongShelters);

    expect(area.district).toBe("수성구");
    expect(area.latitude).toBeCloseTo(35.842, 3);
    expect(area.longitude).toBeCloseTo(128.652, 3);
    expect(area.radiusM).toBeGreaterThan(2_000);
    expect(area.radiusM).toBeLessThan(4_000);
  });

  it("never shrinks a district area below the minimum browsing radius", () => {
    const area = heatReliefSearchArea({ ...defaultOrigin, gu: "중구" }, [
      { latitude: 35.8695, longitude: 128.6025 },
    ]);

    expect(area).toEqual({
      latitude: 35.8695,
      longitude: 128.6025,
      radiusM: DISTRICT_AREA_MIN_RADIUS_M,
      district: "중구",
    });
  });

  it("keeps a location the user picked as the origin even while a district is selected", () => {
    expect(
      heatReliefSearchArea(
        { lat: 35.8571, lng: 128.6221, radius: 500, gu: "수성구" },
        suseongShelters,
      ),
    ).toEqual({ latitude: 35.8571, longitude: 128.6221, radiusM: 500, district: "수성구" });
  });

  it("falls back to labelled facilities only when a district has no shelters to anchor it", () => {
    expect(heatReliefSearchArea({ ...defaultOrigin, gu: "달성군" }, [])).toEqual({
      latitude: DEFAULT_PUBLIC_SHELTER_ORIGIN.lat,
      longitude: DEFAULT_PUBLIC_SHELTER_ORIGIN.lng,
      radiusM: 0,
      district: "달성군",
    });
  });
});
