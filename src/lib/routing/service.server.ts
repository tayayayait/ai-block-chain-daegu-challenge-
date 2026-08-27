import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";
import { lineString, nearestPointOnLine, point } from "@turf/turf";
import { z } from "zod";

import { createTmapPedestrianClient } from "@/integrations/tmap/tmap.server";
import { AppError } from "@/lib/error-dto";
import { getServerEnv } from "@/lib/env.server";
import { assessAccessibility } from "./accessibility";
import { createRouteCacheKey, tenMinuteSunBucket } from "./cache-key";
import { normalizeRouteCandidates } from "./candidates";
import {
  createSupabaseRoutingRepository,
  type RouteSpatialContext,
  type RoutingRepository,
} from "./repository.server";
import { ACCESSIBILITY_NOTICE, accessibilityNoticeForOption, selectRoutePlan } from "./score";
import {
  boundedShadowLengthMeters,
  createBuildingShadow,
  filterShadowsIntersectingRoute,
  splitRouteByShade,
  type ShadeGeometry,
} from "./shade";
import { calculateSunState } from "./sun";
import type { GeoPosition, RouteCandidate, TmapPedestrianSearchOption } from "./types";

const CoordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const RequestTimeSchema = z
  .union([z.date(), z.string().datetime({ offset: true })])
  .transform((value) => (value instanceof Date ? new Date(value) : new Date(value)))
  .refine((value) => Number.isFinite(value.getTime()));
const RouteRequestSchema = z
  .object({
    start: CoordinateSchema,
    destination: CoordinateSchema,
    shelterId: z.string().regex(/^DG-\d{4}$/u),
    at: RequestTimeSchema,
  })
  .strict();

const NonNegativeSchema = z.number().finite().nonnegative();
const RatioSchema = z.number().finite().min(0).max(1);
const SearchOptionSchema = z.enum(["0", "4", "10", "30"]);
const RouteCandidateSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    source: z.literal("TMAP"),
    searchOption: SearchOptionSchema,
    coordinates: z.array(CoordinateSchema).min(2).max(20_000),
    distanceM: z.number().finite().positive(),
    elderDurationSec: z.number().int().positive(),
    providerDurationSec: z.number().finite().positive().nullable(),
  })
  .strict();

const CoverageSchema = z.enum(["DAEGU_ALL", "PARK_ONLY", "DISTRICT_ONLY", "COMMUNITY_PARTIAL"]);
const ConfidenceSchema = z.enum(["VERIFIED_SOURCE", "DERIVED", "COMMUNITY", "UNKNOWN"]);
const CandidateWarningSchema = z.enum([
  "BARRIER_EVIDENCE_UNCERTAIN",
  "BARRIER_COVERAGE_PARTIAL",
  "REST_GAP_OVER_300M",
  "REST_COVERAGE_PARTIAL",
  "SPATIAL_CONTEXT_UNAVAILABLE",
  "BUILDING_SHADOW_PARTIAL",
]);
const PlanWarningSchema = z.enum([
  "TMAP_ALTERNATIVE_UNAVAILABLE",
  "SPATIAL_CONTEXT_UNAVAILABLE",
  "SPATIAL_COVERAGE_PARTIAL",
  "SPATIAL_VERSION_UNAVAILABLE",
  "SPATIAL_VERSION_CHANGED",
  "BUILDING_SHADOW_PARTIAL",
  "CACHE_UNAVAILABLE",
  "CACHE_INVALID",
  "CACHE_WRITE_UNAVAILABLE",
]);
const SegmentSchema = z
  .object({
    exposure: z.enum(["SHADE", "SUN"]),
    coordinates: z.array(CoordinateSchema).min(2),
    distanceM: z.number().finite().positive(),
  })
  .strict();
const ShadowGeometrySchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(CoordinateSchema).min(4)).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(z.array(z.array(CoordinateSchema).min(4)).min(1)).min(1),
    })
    .strict(),
]);
const RestAssessmentSchema = z
  .object({
    matchedRestSpots: z.number().int().nonnegative(),
    requiredStops: z.number().int().nonnegative(),
    restSpotDensity: RatioSchema,
    maximumGapM: NonNegativeSchema,
  })
  .strict();
const ProvenanceSchema = z
  .object({
    spatialVersion: z.string().trim().min(1).max(512),
    coverage: z.array(CoverageSchema),
    confidence: z.array(ConfidenceSchema),
    unknownReasons: z.array(z.string().trim().min(1).max(240)).max(20),
  })
  .strict();
const RouteCandidateDtoSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    source: z.literal("TMAP"),
    searchOption: SearchOptionSchema,
    coordinates: z.array(CoordinateSchema).min(2).max(20_000),
    distanceM: z.number().finite().positive(),
    durationSec: z.number().int().positive(),
    providerDurationSec: z.number().finite().positive().nullable(),
    analysisState: z.enum(["COMPLETE", "SPATIAL_UNAVAILABLE"]),
    shadeRatio: RatioSchema.nullable(),
    shadeDistanceM: NonNegativeSchema.nullable(),
    sunDistanceM: NonNegativeSchema.nullable(),
    segments: z.array(SegmentSchema),
    shadows: z.array(ShadowGeometrySchema).max(5_000),
    score: RatioSchema.nullable(),
    excluded: z.boolean(),
    exclusionReasons: z.array(z.enum(["CONFIRMED_STAIRS", "CONFIRMED_STEEP_SLOPE"])),
    warnings: z.array(CandidateWarningSchema),
    unknownReasons: z.array(z.string().trim().min(1).max(240)).max(20),
    rest: RestAssessmentSchema.nullable(),
    provenance: ProvenanceSchema,
  })
  .strict();
const FailureSchema = z
  .object({
    code: z.enum(["TMAP_REQUIRED_ROUTE_UNAVAILABLE", "NO_ELIGIBLE_ROUTE"]),
    userMessage: z.string().trim().min(1).max(160),
    retryable: z.boolean(),
  })
  .strict();

export const RoutePlanDtoSchema = z
  .object({
    state: z.enum(["READY", "PARTIAL", "FAILED"]),
    source: z.enum(["LIVE", "CACHE"]),
    selectedCandidateId: z.string().trim().min(1).max(128).nullable(),
    candidates: z.array(RouteCandidateDtoSchema).max(3),
    banner: z.string().trim().min(1).max(160).nullable(),
    badge: z.enum(["시연용 접근성 우선 후보", "TMAP 보행 경로 후보"]),
    notice: z.string().trim().min(1).max(400),
    claim: z.enum(["DEMO_ACCESSIBILITY_CANDIDATE", "TMAP_PEDESTRIAN_CANDIDATE"]),
    warnings: z.array(PlanWarningSchema),
    failure: FailureSchema.nullable(),
    spatialVersion: z.string().trim().min(1).max(512),
    shadowCalculatedAt: z.string().datetime({ offset: true }).nullable(),
    generatedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type RoutePlanDto = z.infer<typeof RoutePlanDtoSchema>;
export interface ShadeRouteRequest {
  readonly start: GeoPosition;
  readonly destination: GeoPosition;
  readonly shelterId: string;
  readonly at: string | Date;
}

export interface TmapPedestrianRoutingClient {
  route(
    input: Readonly<{
      start: GeoPosition;
      destination: GeoPosition;
      searchOption: TmapPedestrianSearchOption;
    }>,
  ): Promise<RouteCandidate>;
}

export interface RoutingServiceDependencies {
  readonly repository: RoutingRepository;
  readonly tmapClient: TmapPedestrianRoutingClient;
  readonly now?: () => Date;
}

type RouteCandidateDto = z.infer<typeof RouteCandidateDtoSchema>;
type PlanWarning = z.infer<typeof PlanWarningSchema>;

const CACHE_TTL_MS = 10 * 60 * 1_000;
const ALTERNATIVE_OPTIONS = ["10", "0"] as const;
const EMPTY_SPATIAL_VERSION = "SPATIAL_VERSION_UNAVAILABLE";
const REQUIRED_SPATIAL_DATASETS = ["BARRIER", "BUILDING", "REST_SPOT"] as const;
const MAXIMUM_SHADOW_DISTANCE_M = 300;
const SPATIAL_UNAVAILABLE_NOTICE =
  "TMAP 보행 경로 후보입니다. 공간자료가 없어 그늘·장애물·휴식 지점 분석은 제공하지 않습니다.";

function defaultDependencies(): RoutingServiceDependencies {
  return {
    repository: createSupabaseRoutingRepository(),
    tmapClient: createTmapPedestrianClient({ appKey: getServerEnv().TMAP_APP_KEY }),
  };
}

function safeCandidate(
  raw: unknown,
  requestedOption: TmapPedestrianSearchOption,
): RouteCandidate | null {
  const parsed = RouteCandidateSchema.safeParse(raw);
  if (!parsed.success || parsed.data.searchOption !== requestedOption) return null;
  return parsed.data as RouteCandidate;
}

async function requestCandidate(
  client: TmapPedestrianRoutingClient,
  request: Readonly<{ start: GeoPosition; destination: GeoPosition }>,
  searchOption: TmapPedestrianSearchOption,
): Promise<RouteCandidate> {
  const raw = await client.route({ ...request, searchOption });
  const parsed = safeCandidate(raw, searchOption);
  if (!parsed) throw new Error("INVALID_TMAP_CANDIDATE");
  return parsed;
}

function cacheKey(
  input: Readonly<{
    start: GeoPosition;
    shelterId: string;
    at: Date;
    spatialVersion: string;
  }>,
): string {
  const scoped = createRouteCacheKey({
    departure: input.start,
    destinationId: input.shelterId,
    at: input.at,
    spatialVersion: input.spatialVersion,
  });
  return createHash("sha256").update(scoped, "utf8").digest("hex");
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function publicUnknownReason(reason: string): string {
  const compact = reason
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return (compact || "공간자료의 미확인 사유가 제공되지 않음").slice(0, 240);
}

function hasRequiredSpatialReleases(spatialVersion: string): boolean {
  const releasedDatasets = new Set(
    spatialVersion.split("|").flatMap((release) => {
      const separator = release.indexOf(":");
      return separator > 0 ? [release.slice(0, separator)] : [];
    }),
  );
  return REQUIRED_SPATIAL_DATASETS.every((dataset) => releasedDatasets.has(dataset));
}

function spatialUnavailableCandidate(
  candidate: RouteCandidate,
  spatialVersion: string,
  reason: string,
): RouteCandidateDto {
  const unknownReason = publicUnknownReason(reason);
  return RouteCandidateDtoSchema.parse({
    id: candidate.id,
    source: candidate.source,
    searchOption: candidate.searchOption,
    coordinates: candidate.coordinates,
    distanceM: candidate.distanceM,
    durationSec: candidate.elderDurationSec,
    providerDurationSec: candidate.providerDurationSec,
    analysisState: "SPATIAL_UNAVAILABLE",
    shadeRatio: null,
    shadeDistanceM: null,
    sunDistanceM: null,
    segments: [],
    shadows: [],
    score: null,
    excluded: false,
    exclusionReasons: [],
    warnings: ["SPATIAL_CONTEXT_UNAVAILABLE"],
    unknownReasons: [unknownReason],
    rest: null,
    provenance: {
      spatialVersion: spatialVersion.slice(0, 512),
      coverage: [],
      confidence: ["UNKNOWN"],
      unknownReasons: [unknownReason],
    },
  });
}

function provenance(context: RouteSpatialContext) {
  const evidence = [...context.buildings, ...context.restSpots, ...context.barriers];
  return {
    spatialVersion: context.spatialVersion.slice(0, 512),
    coverage: uniqueSorted(evidence.map((item) => item.coverage)),
    confidence: uniqueSorted(evidence.map((item) => item.confidence)),
    unknownReasons: uniqueSorted(
      evidence
        .map((item) => item.unknownReason)
        .filter((reason): reason is string => reason !== null)
        .map(publicUnknownReason),
    ).slice(0, 20),
  };
}

function restSpotsAlongRoute(route: readonly GeoPosition[], context: RouteSpatialContext) {
  const routeLine = lineString(route.map((coordinate) => [...coordinate]));
  return context.restSpots.map((spot) => {
    const snapped = nearestPointOnLine(routeLine, point([...spot.coordinate]), { units: "meters" });
    const location = snapped.properties.location;
    return {
      id: spot.id,
      distanceAlongRouteM:
        typeof location === "number" && Number.isFinite(location) ? Math.max(0, location) : 0,
    };
  });
}

function coverageIsComplete(context: RouteSpatialContext, kind: "REST" | "BARRIER"): boolean {
  const evidence = kind === "REST" ? context.restSpots : context.barriers;
  return evidence.length > 0 && evidence.every((item) => item.coverage === "DAEGU_ALL");
}

async function analyzeCandidate(
  candidate: RouteCandidate,
  sun: ReturnType<typeof calculateSunState>,
  repository: RoutingRepository,
  spatialVersion: string,
): Promise<RouteCandidateDto> {
  if (!hasRequiredSpatialReleases(spatialVersion)) {
    return spatialUnavailableCandidate(
      candidate,
      spatialVersion,
      "건물·휴식 지점·장애물 공간자료의 활성 배포본이 없음",
    );
  }

  try {
    const shadowFactor = sun.kind === "DAYLIGHT" ? Math.min(100, 1 / Math.tan(sun.altitudeRad)) : 0;
    const context = await repository.getSpatialContext(candidate.coordinates, shadowFactor);
    if (
      context.buildings.length === 0 &&
      context.restSpots.length === 0 &&
      context.barriers.length === 0
    ) {
      return spatialUnavailableCandidate(
        candidate,
        context.spatialVersion,
        "경로 주변 건물·휴식 지점·장애물 공간자료를 확인할 수 없음",
      );
    }
    const warningSet = new Set<z.infer<typeof CandidateWarningSchema>>();
    const routeProvenance = provenance(context);
    let shadeRatio: number | null = null;
    let shadeDistanceM: number | null = null;
    let sunDistanceM: number | null = null;
    let segments: RouteCandidateDto["segments"] = [];
    const shadows: ShadeGeometry[] = [];

    if (sun.kind === "DAYLIGHT") {
      for (const building of context.buildings) {
        try {
          const projection = boundedShadowLengthMeters(
            building.heightM,
            sun.altitudeRad,
            MAXIMUM_SHADOW_DISTANCE_M,
          );
          if (projection.capped) warningSet.add("BUILDING_SHADOW_PARTIAL");
          shadows.push(
            createBuildingShadow(
              building.geometry,
              building.heightM,
              sun,
              MAXIMUM_SHADOW_DISTANCE_M,
            ),
          );
        } catch {
          warningSet.add("BUILDING_SHADOW_PARTIAL");
        }
      }
      try {
        const shade = splitRouteByShade(candidate.coordinates, shadows);
        shadeRatio = shade.shadeRatio;
        shadeDistanceM = shade.shadeDistanceM;
        sunDistanceM = shade.sunDistanceM;
        segments = shade.segments.map((segment) => ({
          exposure: segment.exposure,
          coordinates: segment.coordinates.map(
            (coordinate) => [coordinate[0], coordinate[1]] as [number, number],
          ),
          distanceM: segment.distanceM,
        }));
      } catch {
        warningSet.add("BUILDING_SHADOW_PARTIAL");
        shadeRatio = 0;
        shadeDistanceM = 0;
        sunDistanceM = candidate.distanceM;
        segments = [
          {
            exposure: "SUN",
            coordinates: candidate.coordinates.map(
              (coordinate) => [coordinate[0], coordinate[1]] as [number, number],
            ),
            distanceM: candidate.distanceM,
          },
        ];
      }
    }

    const accessibility = assessAccessibility(candidate, {
      barriers: context.barriers,
      restSpots: restSpotsAlongRoute(candidate.coordinates, context),
      restCoverageComplete: coverageIsComplete(context, "REST"),
      barrierCoverageComplete: coverageIsComplete(context, "BARRIER"),
    });
    accessibility.warnings.forEach((warning) => warningSet.add(warning));

    return RouteCandidateDtoSchema.parse({
      id: candidate.id,
      source: candidate.source,
      searchOption: candidate.searchOption,
      coordinates: candidate.coordinates,
      distanceM: candidate.distanceM,
      durationSec: candidate.elderDurationSec,
      providerDurationSec: candidate.providerDurationSec,
      analysisState: "COMPLETE",
      shadeRatio,
      shadeDistanceM,
      sunDistanceM,
      segments,
      shadows: filterShadowsIntersectingRoute(candidate.coordinates, shadows),
      score: null,
      excluded: accessibility.excluded,
      exclusionReasons: accessibility.exclusionReasons,
      warnings: [...warningSet].sort(),
      unknownReasons: accessibility.unknownReasons.map(publicUnknownReason).slice(0, 20),
      rest: {
        matchedRestSpots: accessibility.rest.matchedRestSpots,
        requiredStops: accessibility.rest.requiredStops,
        restSpotDensity: accessibility.rest.restSpotDensity,
        maximumGapM: accessibility.rest.maximumGapM,
      },
      provenance: routeProvenance,
    });
  } catch {
    return spatialUnavailableCandidate(
      candidate,
      spatialVersion,
      "경로 주변 공간자료를 불러오지 못함",
    );
  }
}

function failurePlan(
  code: "TMAP_REQUIRED_ROUTE_UNAVAILABLE" | "NO_ELIGIBLE_ROUTE",
  now: Date,
  spatialVersion: string,
  candidates: readonly RouteCandidateDto[] = [],
  warnings: readonly PlanWarning[] = [],
): RoutePlanDto {
  return RoutePlanDtoSchema.parse({
    state: "FAILED",
    source: "LIVE",
    selectedCandidateId: null,
    candidates,
    banner: null,
    badge: "시연용 접근성 우선 후보",
    notice: ACCESSIBILITY_NOTICE,
    claim: "DEMO_ACCESSIBILITY_CANDIDATE",
    warnings: uniqueSorted(warnings),
    failure:
      code === "TMAP_REQUIRED_ROUTE_UNAVAILABLE"
        ? {
            code,
            userMessage: "보행 경로를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
            retryable: true,
          }
        : {
            code,
            userMessage: "확인된 장애물과 교차하지 않는 후보를 찾지 못했습니다.",
            retryable: false,
          },
    spatialVersion,
    shadowCalculatedAt: null,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
  });
}

function withCacheWarning(plan: RoutePlanDto, warning: PlanWarning): RoutePlanDto {
  return RoutePlanDtoSchema.parse({
    ...plan,
    state: plan.state === "READY" ? "PARTIAL" : plan.state,
    warnings: uniqueSorted([...plan.warnings, warning]),
  });
}

export async function planShadeRoute(
  rawInput: ShadeRouteRequest,
  providedDependencies?: RoutingServiceDependencies,
): Promise<RoutePlanDto> {
  const parsedInput = RouteRequestSchema.safeParse(rawInput);
  if (!parsedInput.success) throw new AppError("INVALID_REQUEST");
  const input = parsedInput.data;
  const dependencies = providedDependencies ?? defaultDependencies();
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new AppError("INTERNAL_ERROR");

  const planWarnings = new Set<PlanWarning>();
  let spatialVersion = EMPTY_SPATIAL_VERSION;
  let scopedCacheKey: string | null = null;
  try {
    spatialVersion = await dependencies.repository.getSpatialVersion();
    if (spatialVersion === "NO_ACTIVE_RELEASE") planWarnings.add("SPATIAL_VERSION_UNAVAILABLE");
    scopedCacheKey = cacheKey({
      start: input.start,
      shelterId: input.shelterId,
      at: input.at,
      spatialVersion,
    });
    try {
      const cached = await dependencies.repository.readCache(scopedCacheKey, now);
      if (cached !== null) {
        const parsedCached = RoutePlanDtoSchema.safeParse(cached.result);
        if (
          parsedCached.success &&
          parsedCached.data.expiresAt === cached.expiresAt &&
          new Date(cached.expiresAt).getTime() > now.getTime()
        ) {
          return RoutePlanDtoSchema.parse({ ...parsedCached.data, source: "CACHE" });
        }
        planWarnings.add("CACHE_INVALID");
      }
    } catch {
      planWarnings.add("CACHE_UNAVAILABLE");
    }
  } catch {
    spatialVersion = EMPTY_SPATIAL_VERSION;
    scopedCacheKey = null;
    planWarnings.add("SPATIAL_VERSION_UNAVAILABLE");
  }

  const routeRequest = {
    start: input.start as GeoPosition,
    destination: input.destination as GeoPosition,
  };
  let required: RouteCandidate;
  try {
    required = await requestCandidate(dependencies.tmapClient, routeRequest, "30");
  } catch {
    return failurePlan(
      "TMAP_REQUIRED_ROUTE_UNAVAILABLE",
      now,
      spatialVersion,
      [],
      [...planWarnings],
    );
  }

  const alternatives = await Promise.allSettled(
    ALTERNATIVE_OPTIONS.map((option) =>
      requestCandidate(dependencies.tmapClient, routeRequest, option),
    ),
  );
  const rawCandidates = [
    required,
    ...alternatives.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
  ];
  if (alternatives.some((result) => result.status === "rejected")) {
    planWarnings.add("TMAP_ALTERNATIVE_UNAVAILABLE");
  }
  const routeCandidates = normalizeRouteCandidates(rawCandidates, 3);
  const sun = calculateSunState(input.at, input.start[1], input.start[0]);
  const analyzed = await Promise.all(
    routeCandidates.map((candidate) =>
      analyzeCandidate(candidate, sun, dependencies.repository, spatialVersion),
    ),
  );

  if (analyzed.some((candidate) => candidate.analysisState === "SPATIAL_UNAVAILABLE")) {
    planWarnings.add("SPATIAL_CONTEXT_UNAVAILABLE");
  }
  if (analyzed.some((candidate) => candidate.warnings.includes("BUILDING_SHADOW_PARTIAL"))) {
    planWarnings.add("BUILDING_SHADOW_PARTIAL");
  }
  if (
    analyzed.some(
      (candidate) =>
        candidate.provenance.coverage.length === 0 ||
        candidate.provenance.coverage.some((coverage) => coverage !== "DAEGU_ALL") ||
        candidate.provenance.confidence.includes("UNKNOWN") ||
        candidate.provenance.unknownReasons.length > 0,
    )
  ) {
    planWarnings.add("SPATIAL_COVERAGE_PARTIAL");
  }
  if (
    analyzed.some(
      (candidate) =>
        candidate.analysisState === "COMPLETE" &&
        candidate.provenance.spatialVersion !== spatialVersion,
    )
  ) {
    planWarnings.add("SPATIAL_VERSION_CHANGED");
    scopedCacheKey = null;
  }

  const complete = analyzed.filter((candidate) => candidate.analysisState === "COMPLETE");
  const selectable = complete.filter((candidate) => !candidate.excluded);
  let selectedCandidateId: string;
  let banner: string | null;
  let scored = [...analyzed];

  if (selectable.length === 0) {
    const unavailable = analyzed
      .filter((candidate) => candidate.analysisState === "SPATIAL_UNAVAILABLE")
      .sort(
        (left, right) =>
          left.distanceM - right.distanceM ||
          left.durationSec - right.durationSec ||
          left.id.localeCompare(right.id),
      );
    if (unavailable.length === 0) {
      return failurePlan("NO_ELIGIBLE_ROUTE", now, spatialVersion, analyzed, [...planWarnings]);
    }
    selectedCandidateId = unavailable[0]!.id;
    banner = "공간자료 일부를 불러오지 못해 TMAP 후보만 표시합니다";
    scored = [...unavailable, ...analyzed.filter((candidate) => !unavailable.includes(candidate))];
  } else {
    const selection = selectRoutePlan(
      selectable.map((candidate) => ({
        id: candidate.id,
        durationSec: candidate.durationSec,
        distanceM: candidate.distanceM,
        shadeRatio: candidate.shadeRatio ?? 0,
        restSpotDensity: candidate.rest?.restSpotDensity ?? 0,
        excluded: candidate.excluded,
        searchOption: candidate.searchOption,
      })),
      sun,
    );
    selectedCandidateId = selection.selected.id;
    banner = selection.banner;
    const ranks = new Map(selection.ranked.map((candidate, index) => [candidate.id, index]));
    const scoreById = new Map(
      selection.ranked.map((candidate) => [
        candidate.id,
        "score" in candidate ? candidate.score : null,
      ]),
    );
    scored = analyzed
      .map((candidate) => ({
        ...candidate,
        score: sun.kind === "DAYLIGHT" ? (scoreById.get(candidate.id) ?? null) : null,
      }))
      .sort((left, right) => {
        const leftRank = ranks.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = ranks.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || left.id.localeCompare(right.id);
      });
  }

  const selected = scored.find((candidate) => candidate.id === selectedCandidateId)!;
  const spatialAnalysisAvailable = selected.analysisState === "COMPLETE";
  const result = RoutePlanDtoSchema.parse({
    state: planWarnings.size === 0 ? "READY" : "PARTIAL",
    source: "LIVE",
    selectedCandidateId,
    candidates: scored,
    banner,
    badge: spatialAnalysisAvailable ? "시연용 접근성 우선 후보" : "TMAP 보행 경로 후보",
    notice: spatialAnalysisAvailable
      ? accessibilityNoticeForOption(selected.searchOption)
      : SPATIAL_UNAVAILABLE_NOTICE,
    claim: spatialAnalysisAvailable ? "DEMO_ACCESSIBILITY_CANDIDATE" : "TMAP_PEDESTRIAN_CANDIDATE",
    warnings: uniqueSorted([...planWarnings]),
    failure: null,
    spatialVersion,
    shadowCalculatedAt: sun.kind === "DAYLIGHT" ? input.at.toISOString() : null,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
  });

  const cacheableWithoutSpatialAnalysis =
    scopedCacheKey !== null && !hasRequiredSpatialReleases(spatialVersion);
  const operationallyCacheable =
    !planWarnings.has("TMAP_ALTERNATIVE_UNAVAILABLE") &&
    !planWarnings.has("SPATIAL_VERSION_CHANGED") &&
    (cacheableWithoutSpatialAnalysis ||
      (!planWarnings.has("SPATIAL_CONTEXT_UNAVAILABLE") &&
        !planWarnings.has("SPATIAL_VERSION_UNAVAILABLE")));
  if (!operationallyCacheable || scopedCacheKey === null) return result;

  const validatedCacheKey = scopedCacheKey;

  try {
    await dependencies.repository.writeCache({
      cacheKey: validatedCacheKey,
      destinationShelterId: input.shelterId,
      spatialVersion,
      solarBucket: tenMinuteSunBucket(input.at),
      result: result as unknown as Readonly<Record<string, unknown>>,
      expiresAt: result.expiresAt,
    });
    return result;
  } catch {
    return withCacheWarning(result, "CACHE_WRITE_UNAVAILABLE");
  }
}
