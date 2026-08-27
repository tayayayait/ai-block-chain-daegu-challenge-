import {
  along,
  booleanIntersects,
  booleanPointInPolygon,
  feature,
  featureCollection,
  flatten,
  length,
  lineIntersect,
  lineSliceAlong,
  lineString,
  nearestPointOnLine,
  polygon,
  transformTranslate,
  union,
} from "@turf/turf";
import type { Feature, LineString, MultiPolygon, Polygon, Position } from "geojson";

import { shadowLengthMeters } from "./sun";
import type { GeoPosition, SunState } from "./types";

export interface PolygonGeometry {
  readonly type: "Polygon";
  readonly coordinates: readonly (readonly GeoPosition[])[];
}

export interface MultiPolygonGeometry {
  readonly type: "MultiPolygon";
  readonly coordinates: readonly (readonly (readonly GeoPosition[])[])[];
}

export type ShadeGeometry = PolygonGeometry | MultiPolygonGeometry;

export function boundedShadowLengthMeters(
  heightM: number,
  altitudeRad: number,
  maximumDistanceM: number,
): Readonly<{ distanceM: number; capped: boolean }> {
  if (!Number.isFinite(maximumDistanceM) || maximumDistanceM <= 0) {
    throw new RangeError("INVALID_MAXIMUM_SHADOW_DISTANCE");
  }
  const projectedDistanceM = shadowLengthMeters(heightM, altitudeRad);
  return {
    distanceM: Math.min(projectedDistanceM, maximumDistanceM),
    capped: projectedDistanceM > maximumDistanceM,
  };
}

function degrees(value: number): number {
  return (value * 180) / Math.PI;
}

function positions(coordinates: readonly GeoPosition[]): Position[] {
  return coordinates.map(([longitude, latitude]) => [longitude, latitude]);
}

function geometryFeature(geometry: ShadeGeometry): Feature<Polygon | MultiPolygon> {
  return feature(geometry as unknown as Polygon | MultiPolygon);
}

function polygonOuterRings(geometry: Polygon | MultiPolygon): Position[][] {
  if (geometry.type === "Polygon") {
    const outer = geometry.coordinates[0];
    return outer ? [outer] : [];
  }
  return geometry.coordinates.flatMap((part) => (part[0] ? [part[0]] : []));
}

/**
 * Creates a swept shadow from the original footprint, translated footprint,
 * and edge quads. Turf union preserves concavities and MultiPolygon parts more
 * faithfully than a single convex hull.
 */
export function createBuildingShadow(
  footprint: ShadeGeometry,
  heightM: number,
  sun: Extract<SunState, { kind: "DAYLIGHT" }>,
  maximumDistanceM = Number.MAX_SAFE_INTEGER,
): ShadeGeometry {
  const base = geometryFeature(footprint);
  const outerRings = polygonOuterRings(base.geometry);
  if (outerRings.length === 0 || outerRings.some((ring) => ring.length < 4)) {
    throw new RangeError("INVALID_BUILDING_FOOTPRINT");
  }

  const shadowDistanceM = boundedShadowLengthMeters(
    heightM,
    sun.altitudeRad,
    maximumDistanceM,
  ).distanceM;
  // Shadow bearing points exactly opposite to the sun position (180 degrees offset)
  const shadowBearingDegrees = (((degrees(sun.azimuthRad) + 180) % 360) + 360) % 360;
  const translated = transformTranslate(base, shadowDistanceM, shadowBearingDegrees, {
    units: "meters",
    mutate: false,
  });
  const translatedRings = polygonOuterRings(translated.geometry);
  if (translatedRings.length !== outerRings.length) {
    throw new Error("SHADOW_GEOMETRY_TRANSLATION_FAILED");
  }

  const pieces: Feature<Polygon | MultiPolygon>[] = [
    ...flatten(base).features,
    ...flatten(translated).features,
  ];
  for (let part = 0; part < outerRings.length; part += 1) {
    const source = outerRings[part]!;
    const target = translatedRings[part]!;
    for (let index = 1; index < source.length; index += 1) {
      const sourceStart = source[index - 1]!;
      const sourceEnd = source[index]!;
      const targetStart = target[index - 1]!;
      const targetEnd = target[index]!;
      pieces.push(
        polygon([
          [sourceStart, sourceEnd, targetEnd, targetStart, sourceStart],
        ]) as Feature<Polygon>,
      );
    }
  }

  const swept = union(featureCollection(pieces));
  if (!swept || (swept.geometry.type !== "Polygon" && swept.geometry.type !== "MultiPolygon")) {
    throw new Error("SHADOW_GEOMETRY_UNION_FAILED");
  }
  return swept.geometry as unknown as ShadeGeometry;
}

export interface ShadeSegment {
  readonly exposure: "SHADE" | "SUN";
  readonly coordinates: readonly GeoPosition[];
  readonly distanceM: number;
}

function toGeoPositions(coordinates: Position[]): GeoPosition[] {
  return coordinates.map((position) => {
    const longitude = position[0];
    const latitude = position[1];
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      throw new RangeError("INVALID_SHADE_SEGMENT");
    }
    return [longitude!, latitude!];
  });
}

export function splitRouteByShade(
  route: readonly GeoPosition[],
  shadows: readonly ShadeGeometry[],
) {
  if (route.length < 2) throw new RangeError("INVALID_ROUTE_GEOMETRY");
  const routeFeature = lineString(positions(route));
  const totalDistanceM = length(routeFeature, { units: "meters" });
  if (!Number.isFinite(totalDistanceM) || totalDistanceM <= 0) {
    throw new RangeError("INVALID_ROUTE_GEOMETRY");
  }

  const shadowFeatures = shadows.map(geometryFeature);

  const splitDistances: number[] = [0, totalDistanceM];
  for (const shadow of shadowFeatures) {
    try {
      const intersections = lineIntersect(routeFeature, shadow);
      for (const pt of intersections.features) {
        const snapped = nearestPointOnLine(routeFeature, pt, { units: "meters" });
        const loc = snapped.properties.location;
        if (
          typeof loc === "number" &&
          Number.isFinite(loc) &&
          loc > 0.5 &&
          loc < totalDistanceM - 0.5
        ) {
          splitDistances.push(loc);
        }
      }
    } catch {
      // Ignore individual geometry intersection failures
    }
  }

  splitDistances.sort((a, b) => a - b);
  const uniqueDistances: number[] = [0];
  for (const d of splitDistances) {
    if (d - uniqueDistances[uniqueDistances.length - 1]! >= 1) {
      uniqueDistances.push(d);
    }
  }
  if (totalDistanceM - uniqueDistances[uniqueDistances.length - 1]! >= 0.5) {
    uniqueDistances.push(totalDistanceM);
  } else {
    uniqueDistances[uniqueDistances.length - 1] = totalDistanceM;
  }

  const rawSegments: ShadeSegment[] = [];
  for (let i = 0; i < uniqueDistances.length - 1; i++) {
    const startM = uniqueDistances[i]!;
    const endM = uniqueDistances[i + 1]!;
    if (endM <= startM) continue;

    const slice = lineSliceAlong(routeFeature, startM, endM, { units: "meters" });
    const distM = length(slice, { units: "meters" });
    if (distM <= 0 || slice.geometry.coordinates.length < 2) continue;

    const midPt = along(slice, distM / 2, { units: "meters" });
    const isShade = shadowFeatures.some((shadow) =>
      booleanPointInPolygon(midPt, shadow, { ignoreBoundary: false }),
    );

    rawSegments.push({
      exposure: isShade ? "SHADE" : "SUN",
      coordinates: toGeoPositions(slice.geometry.coordinates),
      distanceM: distM,
    });
  }

  const mergedSegments: ShadeSegment[] = [];
  for (const seg of rawSegments) {
    const prev = mergedSegments[mergedSegments.length - 1];
    if (prev && prev.exposure === seg.exposure) {
      const lastCoord = prev.coordinates[prev.coordinates.length - 1]!;
      const nextCoords =
        seg.coordinates[0]![0] === lastCoord[0] && seg.coordinates[0]![1] === lastCoord[1]
          ? seg.coordinates.slice(1)
          : seg.coordinates;
      mergedSegments[mergedSegments.length - 1] = {
        exposure: prev.exposure,
        coordinates: [...prev.coordinates, ...nextCoords],
        distanceM: prev.distanceM + seg.distanceM,
      };
    } else {
      mergedSegments.push(seg);
    }
  }

  const segments =
    mergedSegments.length > 0
      ? mergedSegments
      : [
          {
            exposure: "SUN" as const,
            coordinates: toGeoPositions(positions(route)),
            distanceM: totalDistanceM,
          },
        ];

  const shadeDistanceM = segments
    .filter((segment) => segment.exposure === "SHADE")
    .reduce((total, segment) => total + segment.distanceM, 0);
  const sunDistanceM = segments
    .filter((segment) => segment.exposure === "SUN")
    .reduce((total, segment) => total + segment.distanceM, 0);
  const conservationError =
    totalDistanceM === 0
      ? 0
      : Math.abs(totalDistanceM - shadeDistanceM - sunDistanceM) / totalDistanceM;

  return {
    segments,
    totalDistanceM,
    shadeDistanceM,
    sunDistanceM,
    shadeRatio: totalDistanceM === 0 ? 0 : shadeDistanceM / totalDistanceM,
    conservationError,
  };
}

export function filterShadowsIntersectingRoute(
  route: readonly GeoPosition[],
  shadows: readonly ShadeGeometry[],
): ShadeGeometry[] {
  if (route.length < 2) return [];
  const routeFeature = lineString(positions(route));
  return shadows.filter((shadow) => {
    try {
      return booleanIntersects(routeFeature, geometryFeature(shadow));
    } catch {
      return false;
    }
  });
}
