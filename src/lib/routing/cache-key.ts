import type { GeoPosition } from "./types";

const DEPARTURE_GRID_DEGREES = 0.0001;
const SUN_BUCKET_MS = 10 * 60 * 1_000;

function finiteCoordinate(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("INVALID_ROUTE_COORDINATE");
  return value;
}

export function quantizeCoordinate(position: GeoPosition): GeoPosition {
  return position.map((value) =>
    Number(
      (
        Math.round(finiteCoordinate(value) / DEPARTURE_GRID_DEGREES) * DEPARTURE_GRID_DEGREES
      ).toFixed(4),
    ),
  ) as [number, number];
}

export function tenMinuteSunBucket(at: Date): string {
  const instant = at.getTime();
  if (!Number.isFinite(instant)) throw new RangeError("INVALID_ROUTE_TIME");
  return new Date(Math.floor(instant / SUN_BUCKET_MS) * SUN_BUCKET_MS).toISOString();
}

export function createRouteCacheKey(
  input: Readonly<{
    departure: GeoPosition;
    destinationId: string;
    at: Date;
    spatialVersion: string;
  }>,
): string {
  const departure = quantizeCoordinate(input.departure);
  if (!input.destinationId.trim() || !input.spatialVersion.trim()) {
    throw new RangeError("INVALID_ROUTE_CACHE_SCOPE");
  }
  return [
    "shade-route-v2",
    departure.join(","),
    encodeURIComponent(input.destinationId),
    tenMinuteSunBucket(input.at),
    encodeURIComponent(input.spatialVersion),
  ].join(":");
}
