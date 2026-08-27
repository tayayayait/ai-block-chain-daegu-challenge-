import { lineSlice, lineString, nearestPointOnLine, point } from "@turf/turf";
import { z } from "zod";

import {
  distanceBetweenPositionsM,
  elderWalkingDurationSec,
  routeDistanceMeters,
} from "@/lib/routing/candidates";
import type { GeoPosition, RouteCandidate, TmapPedestrianSearchOption } from "@/lib/routing/types";

const TMAP_PEDESTRIAN_ENDPOINT = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1";
export const TMAP_PEDESTRIAN_SEARCH_OPTIONS = ["0", "4", "10", "30"] as const;

const LongitudeSchema = z.number().finite().min(-180).max(180);
const LatitudeSchema = z.number().finite().min(-90).max(90);
const CoordinateSchema = z.tuple([LongitudeSchema, LatitudeSchema]);
const NumericSchema = z
  .union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?$/u)])
  .transform((value) => Number(value))
  .refine(Number.isFinite);
const NonNegativeNumericSchema = NumericSchema.refine((value) => value >= 0);
const PropertiesSchema = z
  .object({
    index: NonNegativeNumericSchema.refine(Number.isInteger).optional(),
    totalDistance: NonNegativeNumericSchema.optional(),
    totalTime: NonNegativeNumericSchema.optional(),
    distance: NonNegativeNumericSchema.optional(),
    time: NonNegativeNumericSchema.optional(),
  })
  .passthrough();
const FeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.discriminatedUnion("type", [
    z.object({ type: z.literal("Point"), coordinates: CoordinateSchema }),
    z.object({ type: z.literal("LineString"), coordinates: z.array(CoordinateSchema).min(2) }),
  ]),
  properties: PropertiesSchema,
});
const FeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(FeatureSchema).min(1),
});
const RequestSchema = z.object({
  start: CoordinateSchema,
  destination: CoordinateSchema,
  searchOption: z.enum(TMAP_PEDESTRIAN_SEARCH_OPTIONS),
});

export type TmapRoutingErrorCode =
  "CONFIGURATION_ERROR" | "INVALID_REQUEST" | "TIMEOUT" | "PROVIDER_ERROR" | "INVALID_RESPONSE";

export class TmapRoutingError extends Error {
  constructor(readonly code: TmapRoutingErrorCode) {
    super(`TMAP routing request failed: ${code}`);
    this.name = "TmapRoutingError";
  }
}

function coordinateHash(coordinates: readonly GeoPosition[]): string {
  let hash = 2_166_136_261;
  const input = coordinates
    .map(([longitude, latitude]) => `${longitude.toFixed(6)},${latitude.toFixed(6)}`)
    .join(";");
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function clipRouteToEndpoints(
  coordinates: readonly GeoPosition[],
  start: GeoPosition,
  destination: GeoPosition,
): readonly GeoPosition[] {
  if (coordinates.length < 2) return coordinates;
  try {
    const routeLine = lineString(coordinates.map(([longitude, latitude]) => [longitude, latitude]));
    const startSnapped = nearestPointOnLine(routeLine, point([...start]), { units: "meters" });
    const destSnapped = nearestPointOnLine(routeLine, point([...destination]), { units: "meters" });

    const startLoc = startSnapped.properties.location;
    const destLoc = destSnapped.properties.location;

    if (
      typeof startLoc === "number" &&
      typeof destLoc === "number" &&
      Number.isFinite(startLoc) &&
      Number.isFinite(destLoc) &&
      destLoc > startLoc
    ) {
      const sliced = lineSlice(startSnapped, destSnapped, routeLine);
      const slicedCoords = sliced.geometry.coordinates as [number, number][];
      const uniqueCoords: GeoPosition[] = [];
      for (const coord of slicedCoords) {
        const prev = uniqueCoords.at(-1);
        if (!prev || Math.abs(prev[0] - coord[0]) > 1e-7 || Math.abs(prev[1] - coord[1]) > 1e-7) {
          uniqueCoords.push([coord[0], coord[1]]);
        }
      }
      if (uniqueCoords.length >= 2) {
        return uniqueCoords;
      }
    }
  } catch {
    // Fall back to original coordinates on any geometry failure
  }
  return coordinates;
}

function normalizeResponse(
  payload: unknown,
  searchOption: TmapPedestrianSearchOption,
  endpoints?: Readonly<{ start: GeoPosition; destination: GeoPosition }>,
): RouteCandidate {
  const parsed = FeatureCollectionSchema.safeParse(payload);
  if (!parsed.success) throw new TmapRoutingError("INVALID_RESPONSE");
  const features = [...parsed.data.features].sort(
    (a, b) =>
      (a.properties.index ?? Number.MAX_SAFE_INTEGER) -
      (b.properties.index ?? Number.MAX_SAFE_INTEGER),
  );
  const lines = features.filter(
    (
      feature,
    ): feature is typeof feature & {
      geometry: { type: "LineString"; coordinates: GeoPosition[] };
    } => feature.geometry.type === "LineString",
  );
  if (lines.length === 0) throw new TmapRoutingError("INVALID_RESPONSE");
  const rawCoordinates: GeoPosition[] = [];
  for (const lineFeature of lines) {
    const first = lineFeature.geometry.coordinates[0]!;
    const previousEnd = rawCoordinates.at(-1);
    if (previousEnd && distanceBetweenPositionsM(previousEnd, first) > 2) {
      throw new TmapRoutingError("INVALID_RESPONSE");
    }
    for (const coordinate of lineFeature.geometry.coordinates) {
      const previous = rawCoordinates.at(-1);
      if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) {
        rawCoordinates.push(coordinate);
      }
    }
  }

  const coordinates = endpoints
    ? clipRouteToEndpoints(rawCoordinates, endpoints.start, endpoints.destination)
    : rawCoordinates;

  const summary = features.find(
    (feature) => feature.properties.totalDistance !== undefined,
  )?.properties;
  const reportedDistance = summary?.totalDistance;
  const lineDistance = lines.reduce(
    (total, feature) => total + (feature.properties.distance ?? 0),
    0,
  );
  const wasClipped =
    coordinates !== rawCoordinates &&
    (coordinates.length !== rawCoordinates.length ||
      coordinates[0]![0] !== rawCoordinates[0]![0] ||
      coordinates[0]![1] !== rawCoordinates[0]![1] ||
      coordinates.at(-1)![0] !== rawCoordinates.at(-1)![0] ||
      coordinates.at(-1)![1] !== rawCoordinates.at(-1)![1]);
  const distanceM = wasClipped
    ? routeDistanceMeters(coordinates)
    : reportedDistance && reportedDistance > 0
      ? reportedDistance
      : lineDistance || routeDistanceMeters(coordinates);
  if (!Number.isFinite(distanceM) || distanceM <= 0) throw new TmapRoutingError("INVALID_RESPONSE");
  const providerDurationSec =
    summary?.totalTime ??
    (lines.reduce((total, feature) => total + (feature.properties.time ?? 0), 0) || null);
  if (
    providerDurationSec !== null &&
    (!Number.isFinite(providerDurationSec) || providerDurationSec <= 0)
  ) {
    throw new TmapRoutingError("INVALID_RESPONSE");
  }
  return {
    id: `tmap-${searchOption}-${coordinateHash(coordinates)}`,
    source: "TMAP",
    searchOption,
    coordinates,
    distanceM,
    elderDurationSec: elderWalkingDurationSec(distanceM),
    providerDurationSec,
  };
}

export function createTmapPedestrianClient(
  options: Readonly<{
    appKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }>,
) {
  if (!options.appKey.trim()) throw new TmapRoutingError("CONFIGURATION_ERROR");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  return {
    async route(
      input: Readonly<{
        start: GeoPosition;
        destination: GeoPosition;
        searchOption: TmapPedestrianSearchOption;
      }>,
    ): Promise<RouteCandidate> {
      const parsedInput = RequestSchema.safeParse(input);
      if (!parsedInput.success) throw new TmapRoutingError("INVALID_REQUEST");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(TMAP_PEDESTRIAN_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            appKey: options.appKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            startX: parsedInput.data.start[0],
            startY: parsedInput.data.start[1],
            endX: parsedInput.data.destination[0],
            endY: parsedInput.data.destination[1],
            startName: encodeURIComponent("출발"),
            endName: encodeURIComponent("도착"),
            reqCoordType: "WGS84GEO",
            resCoordType: "WGS84GEO",
            searchOption: parsedInput.data.searchOption,
            sort: "index",
            speed: 0,
            angle: 0,
          }),
        });
        if (!response.ok) throw new TmapRoutingError("PROVIDER_ERROR");
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new TmapRoutingError("INVALID_RESPONSE");
        }
        return normalizeResponse(payload, parsedInput.data.searchOption, {
          start: parsedInput.data.start,
          destination: parsedInput.data.destination,
        });
      } catch (error) {
        if (error instanceof TmapRoutingError) throw error;
        if (controller.signal.aborted) throw new TmapRoutingError("TIMEOUT");
        throw new TmapRoutingError("PROVIDER_ERROR");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
