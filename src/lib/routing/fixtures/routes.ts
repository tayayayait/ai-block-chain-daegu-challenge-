import type { RouteCandidate } from "../types";

const origin = [128.601, 35.87] as const;

export function routeFixture(
  overrides: Partial<RouteCandidate> & Pick<RouteCandidate, "id">,
): RouteCandidate {
  return {
    id: overrides.id,
    searchOption: overrides.searchOption ?? "30",
    coordinates: overrides.coordinates ?? [origin, [128.611, 35.87]],
    distanceM: overrides.distanceM ?? 900,
    elderDurationSec: overrides.elderDurationSec ?? 1_200,
    providerDurationSec: overrides.providerDurationSec ?? 700,
    source: "TMAP",
  };
}

export const daeguRoute = [
  [128.6005, 35.87],
  [128.6015, 35.87],
] as const;
