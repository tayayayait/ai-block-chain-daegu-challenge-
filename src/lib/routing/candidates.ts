import type { GeoPosition, RouteCandidate, TmapPedestrianSearchOption } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;
const ELDER_WALKING_SPEED_MPS = 0.75;
const OVERLAP_SAMPLE_M = 5;
const OVERLAP_TOLERANCE_M = 6;

const optionPriority: Readonly<Record<TmapPedestrianSearchOption, number>> = {
  "30": 0,
  "10": 1,
  "0": 2,
  "4": 3,
};

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceBetweenPositionsM(a: GeoPosition, b: GeoPosition): number {
  const latitudeDelta = radians(b[1] - a[1]);
  const longitudeDelta = radians(b[0] - a[0]);
  const latitudeA = radians(a[1]);
  const latitudeB = radians(b[1]);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function routeDistanceMeters(coordinates: readonly GeoPosition[]): number {
  let distance = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    distance += distanceBetweenPositionsM(coordinates[index - 1]!, coordinates[index]!);
  }
  return distance;
}

export function elderWalkingDurationSec(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new RangeError("INVALID_ROUTE_DISTANCE");
  return Math.ceil(distanceM / ELDER_WALKING_SPEED_MPS);
}

interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

function localPoint(position: GeoPosition, referenceLatitude: number): LocalPoint {
  return {
    x: radians(position[0]) * EARTH_RADIUS_M * Math.cos(radians(referenceLatitude)),
    y: radians(position[1]) * EARTH_RADIUS_M,
  };
}

function distanceToSegment(point: LocalPoint, start: LocalPoint, end: LocalPoint): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  if (deltaX === 0 && deltaY === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
        (deltaX * deltaX + deltaY * deltaY),
    ),
  );
  return Math.hypot(
    point.x - (start.x + projection * deltaX),
    point.y - (start.y + projection * deltaY),
  );
}

function interpolate(start: GeoPosition, end: GeoPosition, fraction: number): GeoPosition {
  return [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction];
}

/**
 * Measures how much of the shorter line stays within six metres of the other.
 * Sampling avoids relying on identical vertex segmentation from route providers.
 */
export function geometryOverlapRatio(
  first: readonly GeoPosition[],
  second: readonly GeoPosition[],
): number {
  if (first.length < 2 || second.length < 2) return 0;
  const firstLength = routeDistanceMeters(first);
  const secondLength = routeDistanceMeters(second);
  const [shorter, shorterLength, other] =
    firstLength <= secondLength ? [first, firstLength, second] : [second, secondLength, first];
  if (shorterLength <= 0) return 0;

  const referenceLatitude =
    [...shorter, ...other].reduce((total, coordinate) => total + coordinate[1], 0) /
    (shorter.length + other.length);
  const otherSegments = other
    .slice(1)
    .map(
      (end, index) =>
        [localPoint(other[index]!, referenceLatitude), localPoint(end, referenceLatitude)] as const,
    );
  let coveredM = 0;

  for (let index = 1; index < shorter.length; index += 1) {
    const start = shorter[index - 1]!;
    const end = shorter[index]!;
    const segmentLength = distanceBetweenPositionsM(start, end);
    const samples = Math.max(1, Math.ceil(segmentLength / OVERLAP_SAMPLE_M));
    const sampleLength = segmentLength / samples;
    for (let sample = 0; sample < samples; sample += 1) {
      const midpoint = interpolate(start, end, (sample + 0.5) / samples);
      const localMidpoint = localPoint(midpoint, referenceLatitude);
      const nearOther = otherSegments.some(
        ([otherStart, otherEnd]) =>
          distanceToSegment(localMidpoint, otherStart, otherEnd) <= OVERLAP_TOLERANCE_M,
      );
      if (nearOther) coveredM += sampleLength;
    }
  }
  return Math.min(1, coveredM / shorterLength);
}

function candidateOrder(a: RouteCandidate, b: RouteCandidate): number {
  return (
    optionPriority[a.searchOption] - optionPriority[b.searchOption] ||
    a.distanceM - b.distanceM ||
    a.id.localeCompare(b.id)
  );
}

export function normalizeRouteCandidates(
  candidates: readonly RouteCandidate[],
  maximum = 3,
): readonly RouteCandidate[] {
  const unique: RouteCandidate[] = [];
  for (const candidate of [...candidates].sort(candidateOrder)) {
    if (
      candidate.coordinates.length >= 2 &&
      !unique.some(
        (existing) => geometryOverlapRatio(existing.coordinates, candidate.coordinates) >= 0.95,
      )
    ) {
      unique.push(candidate);
    }
    if (unique.length === maximum) break;
  }
  return unique;
}
