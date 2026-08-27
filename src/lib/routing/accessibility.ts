import { booleanIntersects, feature, lineString } from "@turf/turf";
import type { Geometry, Position } from "geojson";

import type {
  BarrierEvidence,
  BarrierGeometry,
  GeoPosition,
  MatchedRestSpot,
  RouteCandidate,
} from "./types";

export type AccessibilityWarning =
  | "BARRIER_EVIDENCE_UNCERTAIN"
  | "BARRIER_COVERAGE_PARTIAL"
  | "REST_GAP_OVER_300M"
  | "REST_COVERAGE_PARTIAL";

export type ExclusionReason = "CONFIRMED_STAIRS" | "CONFIRMED_STEEP_SLOPE";

function routeIntersects(route: readonly GeoPosition[], geometry: BarrierGeometry): boolean {
  if (route.length < 2) throw new RangeError("INVALID_ROUTE_GEOMETRY");
  const routeFeature = lineString(route.map((position) => [...position] as Position));
  const barrierFeature = feature(geometry as unknown as Geometry);
  return booleanIntersects(routeFeature, barrierFeature);
}

function exclusionReason(barrier: BarrierEvidence): ExclusionReason | null {
  if (
    barrier.unknownReason ||
    barrier.confidence === "UNKNOWN" ||
    barrier.confidence === "COMMUNITY"
  ) {
    return null;
  }
  if (barrier.barrierType === "STAIRS" && barrier.confidence === "VERIFIED_SOURCE") {
    return "CONFIRMED_STAIRS";
  }
  if (
    barrier.barrierType === "STEEP_SLOPE" &&
    (barrier.confidence === "DERIVED" || barrier.confidence === "VERIFIED_SOURCE") &&
    barrier.slopePercent !== null &&
    barrier.slopePercent > 5
  ) {
    return "CONFIRMED_STEEP_SLOPE";
  }
  return null;
}

export function assessRestStops(
  distanceM: number,
  restSpots: readonly MatchedRestSpot[],
  coverageComplete: boolean,
) {
  const validDistances = [
    ...new Map(
      restSpots
        .filter(
          (spot) =>
            Number.isFinite(spot.distanceAlongRouteM) &&
            spot.distanceAlongRouteM > 0 &&
            spot.distanceAlongRouteM < distanceM,
        )
        .map((spot) => [spot.id, spot.distanceAlongRouteM]),
    ).values(),
  ].sort((a, b) => a - b);
  const stops = [0, ...validDistances, distanceM];
  const gaps = stops.slice(1).map((position, index) => position - stops[index]!);
  const maximumGapM = Math.max(0, ...gaps);
  if (!Number.isFinite(distanceM) || distanceM < 0) {
    throw new RangeError("INVALID_ROUTE_DISTANCE");
  }
  const requiredStops = Math.max(0, Math.ceil(distanceM / 300) - 1);
  const warnings: AccessibilityWarning[] = [];
  if (maximumGapM > 300) warnings.push("REST_GAP_OVER_300M");
  if (!coverageComplete) warnings.push("REST_COVERAGE_PARTIAL");
  return {
    matchedRestSpots: validDistances.length,
    requiredStops,
    restSpotDensity: requiredStops === 0 ? 1 : Math.min(1, validDistances.length / requiredStops),
    maximumGapM,
    warnings,
  } as const;
}

export function assessAccessibility(
  route: RouteCandidate,
  context: Readonly<{
    barriers: readonly BarrierEvidence[];
    restSpots: readonly MatchedRestSpot[];
    restCoverageComplete: boolean;
    barrierCoverageComplete?: boolean;
  }>,
) {
  const intersecting = context.barriers.filter((barrier) =>
    routeIntersects(route.coordinates, barrier.geometry),
  );
  const exclusionReasons = [
    ...new Set(intersecting.map(exclusionReason).filter((reason) => reason !== null)),
  ];
  const warnings = new Set<AccessibilityWarning>(
    assessRestStops(route.distanceM, context.restSpots, context.restCoverageComplete).warnings,
  );
  if (intersecting.some((barrier) => exclusionReason(barrier) === null)) {
    warnings.add("BARRIER_EVIDENCE_UNCERTAIN");
  }
  if (context.barrierCoverageComplete !== true) warnings.add("BARRIER_COVERAGE_PARTIAL");

  return {
    excluded: exclusionReasons.length > 0,
    exclusionReasons,
    warnings: [...warnings].sort(),
    unknownReasons: [
      ...new Set(
        intersecting.map((barrier) => barrier.unknownReason).filter((reason) => reason !== null),
      ),
    ],
    safetyClaim: "DEMO_ACCESSIBILITY_CANDIDATE" as const,
    rest: assessRestStops(route.distanceM, context.restSpots, context.restCoverageComplete),
  };
}
