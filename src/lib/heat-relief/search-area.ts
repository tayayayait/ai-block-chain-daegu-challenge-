import {
  inferPublicShelterOriginSource,
  type ShelterSearchQuery,
} from "@/lib/shelters/search-schema";

import { distanceBetweenM, type HeatReliefCoordinate } from "./public-catalog";

export const DISTRICT_AREA_PADDING_M = 600;
export const DISTRICT_AREA_MIN_RADIUS_M = 1_000;
export const DISTRICT_AREA_MAX_RADIUS_M = 30_000;

export type HeatReliefSearchArea = Readonly<{
  latitude: number;
  longitude: number;
  radiusM: number;
  district: string | null;
}>;

function boundsCenter(shelters: readonly HeatReliefCoordinate[]): HeatReliefCoordinate | null {
  if (shelters.length === 0) return null;
  const latitudes = shelters.map(({ latitude }) => latitude);
  const longitudes = shelters.map(({ longitude }) => longitude);
  return {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
  };
}

function coverRadiusM(
  center: HeatReliefCoordinate,
  shelters: readonly HeatReliefCoordinate[],
): number {
  const reach = shelters.reduce(
    (farthest, shelter) => Math.max(farthest, distanceBetweenM(center, shelter)),
    0,
  );
  return Math.min(
    DISTRICT_AREA_MAX_RADIUS_M,
    Math.max(DISTRICT_AREA_MIN_RADIUS_M, Math.round(reach) + DISTRICT_AREA_PADDING_M),
  );
}

/**
 * Where the map looks for public heat-relief facilities.
 *
 * Without a district the origin the user searched from stays authoritative. A district picked at
 * the default city-centre origin is a district-wide browse instead, so the district's own shelters
 * — not the city centre — anchor the area, the same way the shelter search widens its radius for a
 * district on the server. Facilities the source tagged with the district are kept by
 * `findNearbyHeatReliefPoints` regardless of that radius, so a district with no shelters yet still
 * shows its own labelled facilities and nothing from its neighbours.
 */
export function heatReliefSearchArea(
  query: Readonly<Pick<ShelterSearchQuery, "lat" | "lng" | "radius" | "gu">>,
  shelters: readonly HeatReliefCoordinate[],
): HeatReliefSearchArea {
  const district = query.gu ?? null;
  const origin = {
    latitude: query.lat,
    longitude: query.lng,
    radiusM: query.radius,
    district,
  };
  if (district === null || inferPublicShelterOriginSource(query) === "SELECTED_LOCATION") {
    return Object.freeze(origin);
  }

  const center = boundsCenter(shelters);
  if (center === null) return Object.freeze({ ...origin, radiusM: 0 });
  return Object.freeze({
    ...center,
    radiusM: coverRadiusM(center, shelters),
    district,
  });
}
