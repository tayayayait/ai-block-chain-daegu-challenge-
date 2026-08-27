import "@tanstack/react-start/server-only";

import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";
import { ShelterIdSchema } from "@/lib/shelters/public-dto";
import type { BarrierEvidence, GeoPosition, SpatialConfidence, SpatialCoverage } from "./types";
import type { ShadeGeometry } from "./shade";

const CoordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const RouteSchema = z.array(CoordinateSchema).min(2);
const RingSchema = z.array(CoordinateSchema).min(4);
const PolygonCoordinatesSchema = z.array(RingSchema).min(1);
const MultiPolygonCoordinatesSchema = z.array(PolygonCoordinatesSchema).min(1);
const CoverageSchema = z.enum(["DAEGU_ALL", "PARK_ONLY", "DISTRICT_ONLY", "COMMUNITY_PARTIAL"]);
const ConfidenceSchema = z.enum(["VERIFIED_SOURCE", "DERIVED", "COMMUNITY", "UNKNOWN"]);
const UnknownReasonSchema = z.string().trim().min(1).nullable();
const NumericSchema = z
  .union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?$/u)])
  .transform(Number)
  .refine(Number.isFinite);
const PositiveNumericSchema = NumericSchema.refine((value) => value > 0);
const UuidSchema = z.string().uuid();

const PolygonGeometrySchema = z
  .object({ type: z.literal("Polygon"), coordinates: PolygonCoordinatesSchema })
  .strict();
const MultiPolygonGeometrySchema = z
  .object({ type: z.literal("MultiPolygon"), coordinates: MultiPolygonCoordinatesSchema })
  .strict();
const BarrierGeometrySchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("LineString"), coordinates: z.array(CoordinateSchema).min(2) })
    .strict(),
  z
    .object({
      type: z.literal("MultiLineString"),
      coordinates: z.array(z.array(CoordinateSchema).min(2)).min(1),
    })
    .strict(),
  PolygonGeometrySchema,
  MultiPolygonGeometrySchema,
]);

const EvidenceProvenanceShape = {
  confidence: ConfidenceSchema,
  coverage: CoverageSchema,
  unknownReason: UnknownReasonSchema,
} as const;

const BuildingSchema = z
  .object({
    id: UuidSchema,
    heightM: PositiveNumericSchema,
    heightSource: z.string().trim().min(1),
    heightIsEstimated: z.boolean(),
    geometry: z.discriminatedUnion("type", [PolygonGeometrySchema, MultiPolygonGeometrySchema]),
    ...EvidenceProvenanceShape,
  })
  .strict();
const RestSpotSchema = z
  .object({
    id: UuidSchema,
    type: z.enum(["BENCH", "PAVILION", "SHADE_CANOPY", "PARK_FACILITY"]),
    geometry: z.object({ type: z.literal("Point"), coordinates: CoordinateSchema }).strict(),
    ...EvidenceProvenanceShape,
  })
  .strict();
const BarrierSchema = z
  .object({
    id: UuidSchema,
    type: z.enum(["STAIRS", "STEEP_SLOPE"]),
    slopePercent: NumericSchema.nullable(),
    geometry: BarrierGeometrySchema,
    ...EvidenceProvenanceShape,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === "STAIRS" && value.slopePercent !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["slopePercent"], message: "STAIRS" });
    }
    if (value.type === "STEEP_SLOPE" && (value.slopePercent ?? 0) <= 5) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slopePercent"],
        message: "STEEP_SLOPE",
      });
    }
  });
const SpatialContextSchema = z
  .object({
    buildings: z.array(BuildingSchema),
    restSpots: z.array(RestSpotSchema),
    barriers: z.array(BarrierSchema),
    spatialVersion: z.string().trim().min(1),
  })
  .strict();

const ReleaseSchema = z
  .object({
    dataset: z.enum(["BUILDING", "REST_SPOT", "BARRIER"]),
    version: z.string().trim().min(1),
  })
  .strict();
const CacheKeySchema = z.string().regex(/^[0-9a-f]{64}$/u);
const IsoDateSchema = z.string().datetime({ offset: true });
const CacheRowSchema = z.object({ route_result: z.unknown(), expires_at: IsoDateSchema }).strict();
const CacheWriteSchema = z
  .object({
    cacheKey: CacheKeySchema,
    destinationShelterId: ShelterIdSchema,
    spatialVersion: z.string().trim().min(1),
    solarBucket: IsoDateSchema,
    result: z.record(z.unknown()),
    expiresAt: IsoDateSchema,
  })
  .strict();

export type RoutingRepositoryErrorCode =
  | "INVALID_ROUTE"
  | "SPATIAL_QUERY_FAILED"
  | "INVALID_SPATIAL_RESPONSE"
  | "SPATIAL_VERSION_QUERY_FAILED"
  | "INVALID_SPATIAL_VERSION_RESPONSE"
  | "CACHE_READ_FAILED"
  | "INVALID_CACHE_RESPONSE"
  | "CACHE_WRITE_FAILED"
  | "INVALID_CACHE_WRITE";

export class RoutingRepositoryError extends Error {
  constructor(readonly code: RoutingRepositoryErrorCode) {
    super(`Routing repository failed: ${code}`);
    this.name = "RoutingRepositoryError";
  }
}

export interface RoutingQueryResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface RoutingFilterQuery extends PromiseLike<RoutingQueryResult> {
  eq(column: string, value: unknown): RoutingFilterQuery;
  gt(column: string, value: unknown): RoutingFilterQuery;
  order(column: string, options: Readonly<{ ascending: boolean }>): RoutingFilterQuery;
  maybeSingle(): PromiseLike<RoutingQueryResult>;
}

export interface RoutingTableQuery {
  select(columns: string): RoutingFilterQuery;
  upsert(
    value: Readonly<Record<string, unknown>>,
    options: Readonly<{ onConflict: string }>,
  ): PromiseLike<RoutingQueryResult>;
}

export interface RoutingDatabaseClient {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>,
  ): PromiseLike<RoutingQueryResult>;
  from(table: string): RoutingTableQuery;
}

export interface BuildingEvidence {
  readonly id: string;
  readonly heightM: number;
  readonly heightSource: string;
  readonly heightIsEstimated: boolean;
  readonly geometry: ShadeGeometry;
  readonly confidence: SpatialConfidence;
  readonly coverage: SpatialCoverage;
  readonly unknownReason: string | null;
}

export interface RestSpotEvidence {
  readonly id: string;
  readonly type: "BENCH" | "PAVILION" | "SHADE_CANOPY" | "PARK_FACILITY";
  readonly coordinate: GeoPosition;
  readonly confidence: SpatialConfidence;
  readonly coverage: SpatialCoverage;
  readonly unknownReason: string | null;
}

export interface RouteSpatialContext {
  readonly buildings: readonly BuildingEvidence[];
  readonly restSpots: readonly RestSpotEvidence[];
  readonly barriers: readonly BarrierEvidence[];
  readonly spatialVersion: string;
}

export interface CachedRoutingResult {
  readonly result: unknown;
  readonly expiresAt: string;
}

export interface RoutingCacheWrite {
  readonly cacheKey: string;
  readonly destinationShelterId: string;
  readonly spatialVersion: string;
  readonly solarBucket: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly expiresAt: string;
}

export interface RoutingRepository {
  getSpatialVersion(): Promise<string>;
  getSpatialContext(
    route: readonly GeoPosition[],
    shadowFactor?: number,
  ): Promise<RouteSpatialContext>;
  readCache(cacheKey: string, now: Date): Promise<CachedRoutingResult | null>;
  writeCache(input: RoutingCacheWrite): Promise<void>;
}

function defaultClient(): RoutingDatabaseClient {
  return createAdminSupabaseClient() as unknown as RoutingDatabaseClient;
}

function routeWkt(rawRoute: readonly GeoPosition[]): string {
  const parsed = RouteSchema.safeParse(rawRoute);
  if (!parsed.success) throw new RoutingRepositoryError("INVALID_ROUTE");
  return `SRID=4326;LINESTRING(${parsed.data
    .map(([longitude, latitude]) => `${longitude} ${latitude}`)
    .join(",")})`;
}

function mapSpatialContext(raw: unknown): RouteSpatialContext {
  const parsed = SpatialContextSchema.safeParse(raw);
  if (!parsed.success) throw new RoutingRepositoryError("INVALID_SPATIAL_RESPONSE");
  return Object.freeze({
    spatialVersion: parsed.data.spatialVersion,
    buildings: Object.freeze(
      parsed.data.buildings.map((building) =>
        Object.freeze({
          id: building.id,
          heightM: building.heightM,
          heightSource: building.heightSource,
          heightIsEstimated: building.heightIsEstimated,
          geometry: building.geometry as ShadeGeometry,
          confidence: building.confidence,
          coverage: building.coverage,
          unknownReason: building.unknownReason,
        }),
      ),
    ),
    restSpots: Object.freeze(
      parsed.data.restSpots.map((spot) =>
        Object.freeze({
          id: spot.id,
          type: spot.type,
          coordinate: spot.geometry.coordinates as GeoPosition,
          confidence: spot.confidence,
          coverage: spot.coverage,
          unknownReason: spot.unknownReason,
        }),
      ),
    ),
    barriers: Object.freeze(
      parsed.data.barriers.map((barrier) =>
        Object.freeze({
          id: barrier.id,
          barrierType: barrier.type,
          slopePercent: barrier.slopePercent,
          geometry: barrier.geometry as BarrierEvidence["geometry"],
          confidence: barrier.confidence,
          coverage: barrier.coverage,
          unknownReason: barrier.unknownReason,
        }),
      ),
    ),
  });
}

export function createSupabaseRoutingRepository(
  client: RoutingDatabaseClient = defaultClient(),
): RoutingRepository {
  return Object.freeze({
    async getSpatialVersion(): Promise<string> {
      let response: RoutingQueryResult;
      try {
        response = await client
          .from("spatial_data_releases")
          .select("dataset,version")
          .eq("active", true)
          .order("dataset", { ascending: true });
      } catch {
        throw new RoutingRepositoryError("SPATIAL_VERSION_QUERY_FAILED");
      }
      if (response.error !== null) {
        throw new RoutingRepositoryError("SPATIAL_VERSION_QUERY_FAILED");
      }
      const parsed = z.array(ReleaseSchema).safeParse(response.data);
      if (!parsed.success) {
        throw new RoutingRepositoryError("INVALID_SPATIAL_VERSION_RESPONSE");
      }
      const sorted = [...parsed.data].sort((left, right) =>
        left.dataset.localeCompare(right.dataset),
      );
      if (new Set(sorted.map((release) => release.dataset)).size !== sorted.length) {
        throw new RoutingRepositoryError("INVALID_SPATIAL_VERSION_RESPONSE");
      }
      return sorted.length === 0
        ? "NO_ACTIVE_RELEASE"
        : sorted.map((release) => `${release.dataset}:${release.version}`).join("|");
    },

    async getSpatialContext(
      rawRoute: readonly GeoPosition[],
      shadowFactor = 0,
    ): Promise<RouteSpatialContext> {
      const wkt = routeWkt(rawRoute);
      if (!Number.isFinite(shadowFactor) || shadowFactor < 0 || shadowFactor > 100) {
        throw new RoutingRepositoryError("INVALID_ROUTE");
      }
      let response: RoutingQueryResult;
      try {
        response = await client.rpc("route_spatial_context_at_time", {
          p_route: wkt,
          p_buffer_m: 30,
          p_shadow_factor: shadowFactor,
          p_max_shadow_m: 300,
        });
      } catch {
        throw new RoutingRepositoryError("SPATIAL_QUERY_FAILED");
      }
      if (response.error !== null) throw new RoutingRepositoryError("SPATIAL_QUERY_FAILED");
      return mapSpatialContext(response.data);
    },

    async readCache(rawCacheKey: string, now: Date): Promise<CachedRoutingResult | null> {
      const parsedKey = CacheKeySchema.safeParse(rawCacheKey);
      if (!parsedKey.success || !Number.isFinite(now.getTime())) {
        throw new RoutingRepositoryError("CACHE_READ_FAILED");
      }
      let response: RoutingQueryResult;
      try {
        response = await client
          .from("route_cache")
          .select("route_result,expires_at")
          .eq("cache_key", parsedKey.data)
          .gt("expires_at", now.toISOString())
          .maybeSingle();
      } catch {
        throw new RoutingRepositoryError("CACHE_READ_FAILED");
      }
      if (response.error !== null) throw new RoutingRepositoryError("CACHE_READ_FAILED");
      if (response.data === null) return null;
      const parsed = CacheRowSchema.safeParse(response.data);
      if (!parsed.success) throw new RoutingRepositoryError("INVALID_CACHE_RESPONSE");
      return Object.freeze({ result: parsed.data.route_result, expiresAt: parsed.data.expires_at });
    },

    async writeCache(rawInput: RoutingCacheWrite): Promise<void> {
      const parsed = CacheWriteSchema.safeParse(rawInput);
      if (!parsed.success || new Date(parsed.data.expiresAt) <= new Date(parsed.data.solarBucket)) {
        throw new RoutingRepositoryError("INVALID_CACHE_WRITE");
      }
      let response: RoutingQueryResult;
      try {
        response = await client.from("route_cache").upsert(
          {
            cache_key: parsed.data.cacheKey,
            destination_shelter_id: parsed.data.destinationShelterId,
            spatial_version: parsed.data.spatialVersion,
            solar_bucket: parsed.data.solarBucket,
            route_result: parsed.data.result,
            expires_at: parsed.data.expiresAt,
          },
          { onConflict: "cache_key" },
        );
      } catch {
        throw new RoutingRepositoryError("CACHE_WRITE_FAILED");
      }
      if (response.error !== null) throw new RoutingRepositoryError("CACHE_WRITE_FAILED");
    },
  });
}
