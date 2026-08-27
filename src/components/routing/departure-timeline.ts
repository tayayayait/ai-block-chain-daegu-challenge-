import type {
  DepartureComparisonSlotUiDto,
  DepartureComparisonUiDto,
  RouteCandidateUiDto,
  RoutePlanUiDto,
  RouteShadowUiDto,
  RouteUiCoordinate,
} from "./route-ui-dto";

export const DEPARTURE_TIMELINE_MAX_MINUTES = 60;

export interface DepartureTimelineFrame {
  readonly offsetMinutes: number;
  readonly departureAt: string;
  readonly feelsLikeC: number | null;
  readonly shadePercent: number | null;
  readonly directSunMinutes: number | null;
  readonly walkingMinutes: number;
  readonly additionalWalkingMinutes: number;
  readonly interpolated: boolean;
  readonly plan: RoutePlanUiDto;
}

function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(DEPARTURE_TIMELINE_MAX_MINUTES, Math.max(0, value));
}

function interpolate(left: number, right: number, progress: number): number {
  return left + (right - left) * progress;
}

function interpolateNullable(
  left: number | null,
  right: number | null,
  progress: number,
): number | null {
  if (left === null || right === null || !Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }
  return interpolate(left, right, progress);
}

function interpolateDate(left: string, right: string, progress: number): string {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return left;
  return new Date(interpolate(leftTime, rightTime, progress)).toISOString();
}

function roundedCoordinate(value: number): number {
  return Number(value.toFixed(12));
}

function interpolateCoordinate(
  left: RouteUiCoordinate,
  right: RouteUiCoordinate,
  progress: number,
): RouteUiCoordinate {
  return [
    roundedCoordinate(interpolate(left[0], right[0], progress)),
    roundedCoordinate(interpolate(left[1], right[1], progress)),
  ];
}

function samePolygonShape(
  left: readonly (readonly RouteUiCoordinate[])[],
  right: readonly (readonly RouteUiCoordinate[])[],
): boolean {
  return (
    left.length === right.length &&
    left.every((ring, ringIndex) => ring.length === right[ringIndex]?.length)
  );
}

function interpolatePolygon(
  left: readonly (readonly RouteUiCoordinate[])[],
  right: readonly (readonly RouteUiCoordinate[])[],
  progress: number,
): readonly (readonly RouteUiCoordinate[])[] {
  return left.map((ring, ringIndex) =>
    ring.map((coordinate, coordinateIndex) =>
      interpolateCoordinate(coordinate, right[ringIndex]![coordinateIndex]!, progress),
    ),
  );
}

function shadowCoordinates(shadow: RouteShadowUiDto): readonly RouteUiCoordinate[] {
  return shadow.type === "Polygon"
    ? shadow.coordinates.flatMap((ring) => ring)
    : shadow.coordinates.flatMap((polygon) => polygon.flatMap((ring) => ring));
}

function geometryBounds(shadow: RouteShadowUiDto) {
  const coordinates = shadowCoordinates(shadow);
  const longitudes = coordinates.map((coordinate) => coordinate[0]);
  const latitudes = coordinates.map((coordinate) => coordinate[1]);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  return {
    center: [
      (minLongitude + maxLongitude) / 2,
      (minLatitude + maxLatitude) / 2,
    ] as RouteUiCoordinate,
    width: maxLongitude - minLongitude,
    height: maxLatitude - minLatitude,
  };
}

function transformShadowToward(
  left: RouteShadowUiDto,
  right: RouteShadowUiDto,
  progress: number,
): RouteShadowUiDto {
  const leftBounds = geometryBounds(left);
  const rightBounds = geometryBounds(right);
  const center = interpolateCoordinate(leftBounds.center, rightBounds.center, progress);
  const scaleLongitude =
    leftBounds.width > 0 ? interpolate(1, rightBounds.width / leftBounds.width, progress) : 1;
  const scaleLatitude =
    leftBounds.height > 0 ? interpolate(1, rightBounds.height / leftBounds.height, progress) : 1;
  const transform = ([longitude, latitude]: RouteUiCoordinate): RouteUiCoordinate => [
    roundedCoordinate(center[0] + (longitude - leftBounds.center[0]) * scaleLongitude),
    roundedCoordinate(center[1] + (latitude - leftBounds.center[1]) * scaleLatitude),
  ];
  if (left.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: left.coordinates.map((ring) => ring.map(transform)),
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: left.coordinates.map((polygon) => polygon.map((ring) => ring.map(transform))),
  };
}

function interpolateShadow(
  left: RouteShadowUiDto,
  right: RouteShadowUiDto,
  progress: number,
): RouteShadowUiDto {
  if (left.type === "Polygon" && right.type === "Polygon") {
    if (samePolygonShape(left.coordinates, right.coordinates)) {
      return {
        type: "Polygon",
        coordinates: interpolatePolygon(left.coordinates, right.coordinates, progress),
      };
    }
    return transformShadowToward(left, right, progress);
  }
  if (left.type === "MultiPolygon" && right.type === "MultiPolygon") {
    const sameShape =
      left.coordinates.length === right.coordinates.length &&
      left.coordinates.every((polygon, polygonIndex) =>
        samePolygonShape(polygon, right.coordinates[polygonIndex] ?? []),
      );
    if (sameShape) {
      return {
        type: "MultiPolygon",
        coordinates: left.coordinates.map((polygon, polygonIndex) =>
          interpolatePolygon(polygon, right.coordinates[polygonIndex]!, progress),
        ),
      };
    }
    return transformShadowToward(left, right, progress);
  }
  return progress < 0.5 ? left : right;
}

function interpolateShadows(
  left: readonly RouteShadowUiDto[],
  right: readonly RouteShadowUiDto[],
  progress: number,
): readonly RouteShadowUiDto[] {
  const length = Math.max(left.length, right.length);
  const result: RouteShadowUiDto[] = [];
  for (let index = 0; index < length; index += 1) {
    const leftShadow = left[index];
    const rightShadow = right[index];
    if (leftShadow && rightShadow) {
      result.push(interpolateShadow(leftShadow, rightShadow, progress));
    } else if (leftShadow && progress < 0.5) {
      result.push(leftShadow);
    } else if (rightShadow && progress >= 0.5) {
      result.push(rightShadow);
    }
  }
  return result;
}

function interpolateCandidate(
  left: RouteCandidateUiDto,
  right: RouteCandidateUiDto,
  progress: number,
): RouteCandidateUiDto {
  const nearer = progress < 0.5 ? left : right;
  return {
    id: left.id,
    label: nearer.label,
    distanceM: interpolate(left.distanceM, right.distanceM, progress),
    spatialAnalysisAvailable: nearer.spatialAnalysisAvailable,
    shadeRatio: interpolateNullable(left.shadeRatio, right.shadeRatio, progress),
    segments: nearer.segments,
    shadows: interpolateShadows(left.shadows, right.shadows, progress),
    restSpots: nearer.restSpots,
    warnings: nearer.warnings,
  };
}

function interpolatePlan(
  left: RoutePlanUiDto,
  right: RoutePlanUiDto,
  progress: number,
  departureAt: string,
): RoutePlanUiDto {
  const nearer = progress < 0.5 ? left : right;
  if (left.afterSunset !== right.afterSunset) {
    return {
      ...nearer,
      shadowCalculatedAt: nearer.afterSunset ? null : departureAt,
    };
  }

  const rightById = new Map(right.candidates.map((candidate) => [candidate.id, candidate]));
  const candidates = left.candidates.map((candidate) => {
    const matching = rightById.get(candidate.id);
    return matching ? interpolateCandidate(candidate, matching, progress) : candidate;
  });

  return {
    destinationName: nearer.destinationName,
    afterSunset: nearer.afterSunset,
    shadowCalculatedAt:
      nearer.afterSunset || (left.shadowCalculatedAt === null && right.shadowCalculatedAt === null)
        ? null
        : departureAt,
    naverMapUrl: nearer.naverMapUrl,
    candidates,
  };
}

function exactFrame(
  slot: DepartureComparisonSlotUiDto,
  offsetMinutes: number,
): DepartureTimelineFrame {
  return {
    offsetMinutes,
    departureAt: slot.departureAt,
    feelsLikeC: slot.feelsLikeC,
    shadePercent: slot.shadePercent,
    directSunMinutes: slot.directSunMinutes,
    walkingMinutes: slot.walkingMinutes,
    additionalWalkingMinutes: slot.additionalWalkingMinutes,
    interpolated: false,
    plan: slot.plan,
  };
}

export function getDepartureTimelineFrame(
  comparison: DepartureComparisonUiDto,
  requestedOffsetMinutes: number,
): DepartureTimelineFrame {
  const offsetMinutes = clampOffset(requestedOffsetMinutes);
  const slots = [...comparison.slots]
    .filter((slot) => slot.offsetMinutes <= DEPARTURE_TIMELINE_MAX_MINUTES)
    .sort((left, right) => left.offsetMinutes - right.offsetMinutes);
  if (slots.length === 0) throw new RangeError("departure timeline requires at least one slot");

  const exact = slots.find((slot) => slot.offsetMinutes === offsetMinutes);
  if (exact) return exactFrame(exact, offsetMinutes);

  const left = [...slots].reverse().find((slot) => slot.offsetMinutes < offsetMinutes) ?? slots[0]!;
  const right =
    slots.find((slot) => slot.offsetMinutes > offsetMinutes) ?? slots[slots.length - 1]!;
  if (left.offsetMinutes === right.offsetMinutes) return exactFrame(left, offsetMinutes);

  const progress =
    (offsetMinutes - left.offsetMinutes) / (right.offsetMinutes - left.offsetMinutes);
  const departureAt = interpolateDate(left.departureAt, right.departureAt, progress);
  return {
    offsetMinutes,
    departureAt,
    feelsLikeC: interpolateNullable(left.feelsLikeC, right.feelsLikeC, progress),
    shadePercent: interpolateNullable(left.shadePercent, right.shadePercent, progress),
    directSunMinutes: interpolateNullable(left.directSunMinutes, right.directSunMinutes, progress),
    walkingMinutes: interpolate(left.walkingMinutes, right.walkingMinutes, progress),
    additionalWalkingMinutes: interpolate(
      left.additionalWalkingMinutes,
      right.additionalWalkingMinutes,
      progress,
    ),
    interpolated: true,
    plan: interpolatePlan(left.plan, right.plan, progress, departureAt),
  };
}
