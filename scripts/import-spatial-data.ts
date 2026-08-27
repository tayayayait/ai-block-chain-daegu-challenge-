import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  booleanPointInPolygon,
  booleanValid,
  booleanWithin,
  feature as turfFeature,
} from "@turf/turf";
import { z } from "zod";

type Position = [longitudeOrEasting: number, latitudeOrNorthing: number];
type SupportedCrs = "EPSG:4326" | "EPSG:5186" | "EPSG:5187";
type SpatialDataset = "BUILDING" | "REST_SPOT" | "BARRIER";

type PointGeometry = Readonly<{ type: "Point"; coordinates: Position }>;
type LineStringGeometry = Readonly<{ type: "LineString"; coordinates: Position[] }>;
type MultiLineStringGeometry = Readonly<{
  type: "MultiLineString";
  coordinates: Position[][];
}>;
type PolygonGeometry = Readonly<{ type: "Polygon"; coordinates: Position[][] }>;
type MultiPolygonGeometry = Readonly<{
  type: "MultiPolygon";
  coordinates: Position[][][];
}>;
type InputGeometry =
  | PointGeometry
  | LineStringGeometry
  | MultiLineStringGeometry
  | PolygonGeometry
  | MultiPolygonGeometry;

const DAEGU_DEFENSIVE_EXTENT = {
  minimumLongitude: 128.33,
  maximumLongitude: 128.78,
  minimumLatitude: 35.58,
  maximumLatitude: 36.02,
} as const;

const SUPPORTED_SOURCE_CRS = new Set<SupportedCrs>(["EPSG:4326", "EPSG:5186", "EPSG:5187"]);
const REST_TYPES = ["BENCH", "PAVILION", "SHADE_CANOPY", "PARK_FACILITY"] as const;

const requiredText = z.string().trim().min(1).max(500);
const sourceTimestamp = z.string().datetime({ offset: true });
const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const lineCoordinatesSchema = z.array(positionSchema).min(2);
const ringCoordinatesSchema = z.array(positionSchema).min(4);
const polygonCoordinatesSchema = z.array(ringCoordinatesSchema).min(1);

const pointGeometrySchema = z
  .object({ type: z.literal("Point"), coordinates: positionSchema })
  .strict();
const lineGeometrySchema = z
  .object({ type: z.literal("LineString"), coordinates: lineCoordinatesSchema })
  .strict();
const multiLineGeometrySchema = z
  .object({
    type: z.literal("MultiLineString"),
    coordinates: z.array(lineCoordinatesSchema).min(1),
  })
  .strict();
const polygonGeometrySchema = z
  .object({ type: z.literal("Polygon"), coordinates: polygonCoordinatesSchema })
  .strict();
const multiPolygonGeometrySchema = z
  .object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(polygonCoordinatesSchema).min(1),
  })
  .strict();
const geometrySchema = z.discriminatedUnion("type", [
  pointGeometrySchema,
  lineGeometrySchema,
  multiLineGeometrySchema,
  polygonGeometrySchema,
  multiPolygonGeometrySchema,
]);
const coverageGeometrySchema = z.discriminatedUnion("type", [
  polygonGeometrySchema,
  multiPolygonGeometrySchema,
]);

const featurePropertiesSchema = z
  .object({
    sourceFeatureId: requiredText,
    observedAt: sourceTimestamp.nullable().optional(),
    unknownReason: requiredText.nullable().optional(),
    heightM: z.number().finite().positive().max(1_000).optional(),
    heightSource: requiredText.optional(),
    floorCount: z.number().int().positive().max(333).optional(),
    restType: z.enum(REST_TYPES).optional(),
    barrierType: z.enum(["STAIRS", "STEEP_SLOPE"]).optional(),
    slopePercent: z.number().finite().optional(),
    slopeSource: requiredText.optional(),
  })
  .strict();

const featureSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: geometrySchema,
    properties: featurePropertiesSchema,
  })
  .strict();

const featureCollectionSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(featureSchema).min(1),
  })
  .strict();

const manifestBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    sourceName: requiredText,
    sourceUrl: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === "https:", "sourceUrl must use HTTPS"),
    licenseCode: requiredText,
    attribution: requiredText,
    sourceCrs: requiredText,
    targetCrs: z.literal("EPSG:4326"),
    coverageCrs: z.literal("EPSG:4326"),
    datasetUpdatedAt: sourceTimestamp,
    coverage: z.enum(["DAEGU_ALL", "PARK_ONLY", "DISTRICT_ONLY", "COMMUNITY_PARTIAL"]),
    confidence: z.enum(["VERIFIED_SOURCE", "DERIVED", "COMMUNITY", "UNKNOWN"]),
    unknownReason: requiredText.nullable(),
    coverageGeometry: coverageGeometrySchema,
    quality: z
      .object({
        maxDuplicateRate: z.number().finite().min(0).max(0.1),
        maxDatasetAgeDays: z.number().int().positive().max(3_650),
      })
      .strict(),
  })
  .strict();

const manifestSchema = z.discriminatedUnion("dataset", [
  manifestBaseSchema.extend({
    dataset: z.literal("BUILDING"),
    rules: z
      .object({
        kind: z.literal("BUILDING"),
        allowFloorEstimate: z.boolean(),
        floorHeightM: z.number().finite().positive().max(10),
        heightEstimationVersion: requiredText,
      })
      .strict(),
  }),
  manifestBaseSchema.extend({
    dataset: z.literal("REST_SPOT"),
    rules: z.object({ kind: z.literal("REST_SPOT") }).strict(),
  }),
  manifestBaseSchema.extend({
    dataset: z.literal("BARRIER"),
    rules: z.object({ kind: z.literal("BARRIER") }).strict(),
  }),
]);

const spatialImportInputSchema = z
  .object({ manifest: manifestSchema, geojson: featureCollectionSchema })
  .strict();

type ParsedSpatialImport = z.infer<typeof spatialImportInputSchema>;
type ParsedManifest = ParsedSpatialImport["manifest"];
type ParsedFeature = ParsedSpatialImport["geojson"]["features"][number];

export interface SpatialAuditIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface SpatialImportAudit {
  readonly schemaVersion: 1;
  readonly ok: boolean;
  readonly auditedAt: string;
  readonly dataset: SpatialDataset | null;
  readonly version: string | null;
  readonly featureCount: number;
  readonly acceptedCount: number;
  readonly duplicateRate: number;
  readonly issues: readonly SpatialAuditIssue[];
}

interface NormalizedFeatureBase {
  readonly sourceFeatureId: string;
  readonly geometry: InputGeometry;
  readonly observedAt: string | null;
  readonly unknownReason: string | null;
}

interface NormalizedBuildingFeature extends NormalizedFeatureBase {
  readonly geometry: MultiPolygonGeometry;
  readonly heightM: number;
  readonly heightSource: string;
  readonly heightIsEstimated: boolean;
  readonly heightEstimationVersion: string | null;
}

interface NormalizedRestSpotFeature extends NormalizedFeatureBase {
  readonly geometry: PointGeometry;
  readonly restType: (typeof REST_TYPES)[number];
}

interface NormalizedBarrierFeature extends NormalizedFeatureBase {
  readonly geometry:
    LineStringGeometry | MultiLineStringGeometry | PolygonGeometry | MultiPolygonGeometry;
  readonly barrierType: "STAIRS" | "STEEP_SLOPE";
  readonly slopePercent: number | null;
  readonly slopeSource: string | null;
}

export type NormalizedSpatialFeature =
  NormalizedBuildingFeature | NormalizedRestSpotFeature | NormalizedBarrierFeature;

export interface SpatialImportPayload {
  readonly manifest: ParsedManifest;
  readonly features: readonly NormalizedSpatialFeature[];
  readonly audit: SpatialImportAudit;
}

export type SpatialImportPreparation =
  | Readonly<{ ok: true; audit: SpatialImportAudit; payload: SpatialImportPayload }>
  | Readonly<{ ok: false; audit: SpatialImportAudit }>;

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function meridionalArc(latitudeRadians: number): number {
  const semiMajorAxis = 6_378_137;
  const inverseFlattening = 298.257222101;
  const flattening = 1 / inverseFlattening;
  const eccentricitySquared = 2 * flattening - flattening * flattening;
  const e4 = eccentricitySquared * eccentricitySquared;
  const e6 = e4 * eccentricitySquared;

  return (
    semiMajorAxis *
    ((1 - eccentricitySquared / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latitudeRadians -
      ((3 * eccentricitySquared) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) *
        Math.sin(2 * latitudeRadians) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latitudeRadians) -
      ((35 * e6) / 3072) * Math.sin(6 * latitudeRadians))
  );
}

/** Converts Korea 2000 TM positions supplied in x/y order without axis guessing. */
function korea2000TmToWgs84(position: Position, longitudeOfOriginDegrees: number): Position {
  const [easting, northing] = position;
  const semiMajorAxis = 6_378_137;
  const inverseFlattening = 298.257222101;
  const flattening = 1 / inverseFlattening;
  const eccentricitySquared = 2 * flattening - flattening * flattening;
  const secondEccentricitySquared = eccentricitySquared / (1 - eccentricitySquared);
  const latitudeOfOrigin = (38 * Math.PI) / 180;
  const longitudeOfOrigin = (longitudeOfOriginDegrees * Math.PI) / 180;
  const falseEasting = 200_000;
  const falseNorthing = 600_000;
  const scaleFactor = 1;

  const meridionalDistance =
    meridionalArc(latitudeOfOrigin) + (northing - falseNorthing) / scaleFactor;
  const e4 = eccentricitySquared * eccentricitySquared;
  const e6 = e4 * eccentricitySquared;
  const mu =
    meridionalDistance /
    (semiMajorAxis * (1 - eccentricitySquared / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const e1 = (1 - Math.sqrt(1 - eccentricitySquared)) / (1 + Math.sqrt(1 - eccentricitySquared));
  const footprintLatitude =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinFootprint = Math.sin(footprintLatitude);
  const cosFootprint = Math.cos(footprintLatitude);
  const tanFootprint = Math.tan(footprintLatitude);
  const radiusPrimeVertical =
    semiMajorAxis / Math.sqrt(1 - eccentricitySquared * sinFootprint ** 2);
  const radiusMeridian =
    (semiMajorAxis * (1 - eccentricitySquared)) /
    (1 - eccentricitySquared * sinFootprint ** 2) ** 1.5;
  const tangentSquared = tanFootprint ** 2;
  const etaSquared = secondEccentricitySquared * cosFootprint ** 2;
  const d = (easting - falseEasting) / (radiusPrimeVertical * scaleFactor);

  const latitude =
    footprintLatitude -
    ((radiusPrimeVertical * tanFootprint) / radiusMeridian) *
      (d ** 2 / 2 -
        ((5 +
          3 * tangentSquared +
          10 * etaSquared -
          4 * etaSquared ** 2 -
          9 * secondEccentricitySquared) *
          d ** 4) /
          24 +
        ((61 +
          90 * tangentSquared +
          298 * etaSquared +
          45 * tangentSquared ** 2 -
          252 * secondEccentricitySquared -
          3 * etaSquared ** 2) *
          d ** 6) /
          720);
  const longitude =
    longitudeOfOrigin +
    (d -
      ((1 + 2 * tangentSquared + etaSquared) * d ** 3) / 6 +
      ((5 -
        2 * etaSquared +
        28 * tangentSquared -
        3 * etaSquared ** 2 +
        8 * secondEccentricitySquared +
        24 * tangentSquared ** 2) *
        d ** 5) /
        120) /
      cosFootprint;

  return [
    roundCoordinate((longitude * 180) / Math.PI),
    roundCoordinate((latitude * 180) / Math.PI),
  ];
}

export function transformPositionToWgs84(position: Position, sourceCrs: string): Position {
  if (sourceCrs === "EPSG:4326") return [position[0], position[1]];
  if (sourceCrs === "EPSG:5186") return korea2000TmToWgs84(position, 127);
  if (sourceCrs === "EPSG:5187") return korea2000TmToWgs84(position, 129);
  throw new Error("Unsupported source CRS");
}

function transformGeometryToWgs84(geometry: InputGeometry, sourceCrs: SupportedCrs): InputGeometry {
  const transformLine = (line: Position[]) =>
    line.map((position) => transformPositionToWgs84(position, sourceCrs));

  switch (geometry.type) {
    case "Point":
      return {
        type: "Point",
        coordinates: transformPositionToWgs84(geometry.coordinates, sourceCrs),
      };
    case "LineString":
      return { type: "LineString", coordinates: transformLine(geometry.coordinates) };
    case "MultiLineString":
      return { type: "MultiLineString", coordinates: geometry.coordinates.map(transformLine) };
    case "Polygon":
      return { type: "Polygon", coordinates: geometry.coordinates.map(transformLine) };
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((polygon) => polygon.map(transformLine)),
      };
  }
}

function geometryPositions(geometry: InputGeometry): Position[] {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "LineString":
      return geometry.coordinates;
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates.flat();
    case "MultiPolygon":
      return geometry.coordinates.flat(2);
  }
}

function positionsEqual(left: Position, right: Position): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function hasClosedPolygonRings(geometry: InputGeometry): boolean {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return true;
  const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  return rings.every((ring) => {
    const first = ring[0];
    const last = ring.at(-1);
    return first !== undefined && last !== undefined && positionsEqual(first, last);
  });
}

function isInsideDaeguDefensiveExtent(geometry: InputGeometry): boolean {
  return geometryPositions(geometry).every(([longitude, latitude]) => {
    return (
      longitude >= DAEGU_DEFENSIVE_EXTENT.minimumLongitude &&
      longitude <= DAEGU_DEFENSIVE_EXTENT.maximumLongitude &&
      latitude >= DAEGU_DEFENSIVE_EXTENT.minimumLatitude &&
      latitude <= DAEGU_DEFENSIVE_EXTENT.maximumLatitude
    );
  });
}

function isValidGeometry(geometry: InputGeometry): boolean {
  if (!hasClosedPolygonRings(geometry)) return false;
  try {
    return booleanValid(turfFeature(geometry as never));
  } catch {
    return false;
  }
}

function isWithinCoverage(
  geometry: InputGeometry,
  coverage: PolygonGeometry | MultiPolygonGeometry,
) {
  try {
    const coverageFeature = turfFeature(coverage as never);
    if (geometry.type === "Point") {
      return booleanPointInPolygon(turfFeature(geometry as never), coverageFeature as never, {
        ignoreBoundary: false,
      });
    }
    return booleanWithin(turfFeature(geometry as never), coverageFeature as never);
  } catch {
    return false;
  }
}

function issue(code: string, path: string, message: string): SpatialAuditIssue {
  return { code, path, message };
}

function auditSkeleton(
  auditedAt: Date,
  values: Partial<
    Pick<
      SpatialImportAudit,
      "dataset" | "version" | "featureCount" | "acceptedCount" | "duplicateRate"
    >
  > = {},
): SpatialImportAudit {
  return {
    schemaVersion: 1,
    ok: false,
    auditedAt: auditedAt.toISOString(),
    dataset: values.dataset ?? null,
    version: values.version ?? null,
    featureCount: values.featureCount ?? 0,
    acceptedCount: values.acceptedCount ?? 0,
    duplicateRate: values.duplicateRate ?? 0,
    issues: [],
  };
}

function normalizeBuilding(
  feature: ParsedFeature,
  geometry: InputGeometry,
  manifest: Extract<ParsedManifest, { dataset: "BUILDING" }>,
  path: string,
  issues: SpatialAuditIssue[],
): NormalizedBuildingFeature | null {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    issues.push(
      issue("INVALID_GEOMETRY_TYPE", `${path}.geometry`, "BUILDING requires Polygon geometry"),
    );
    return null;
  }
  const properties = feature.properties;
  if (
    properties.restType !== undefined ||
    properties.barrierType !== undefined ||
    properties.slopePercent !== undefined ||
    properties.slopeSource !== undefined
  ) {
    issues.push(
      issue(
        "IRRELEVANT_PROPERTIES",
        `${path}.properties`,
        "BUILDING contains properties for another dataset",
      ),
    );
    return null;
  }

  let heightM: number;
  let heightSource: string;
  let heightIsEstimated: boolean;
  let heightEstimationVersion: string | null;
  if (properties.heightM !== undefined) {
    if (!properties.heightSource) {
      issues.push(
        issue(
          "MISSING_HEIGHT_PROVENANCE",
          `${path}.properties.heightSource`,
          "Direct height requires its source field name or method",
        ),
      );
      return null;
    }
    heightM = properties.heightM;
    heightSource = properties.heightSource;
    heightIsEstimated = false;
    heightEstimationVersion = null;
  } else if (properties.floorCount !== undefined && manifest.rules.allowFloorEstimate) {
    heightM = properties.floorCount * manifest.rules.floorHeightM;
    heightSource = "DERIVED_FLOOR_COUNT";
    heightIsEstimated = true;
    heightEstimationVersion = manifest.rules.heightEstimationVersion;
  } else {
    issues.push(
      issue(
        "MISSING_BUILDING_HEIGHT",
        `${path}.properties`,
        "A positive height or an allowed floor-count estimate is required",
      ),
    );
    return null;
  }

  if (!(heightM > 0 && heightM <= 1_000)) {
    issues.push(
      issue(
        "INVALID_BUILDING_HEIGHT",
        `${path}.properties`,
        "Normalized building height must be positive and at most 1000m",
      ),
    );
    return null;
  }

  return {
    sourceFeatureId: properties.sourceFeatureId,
    geometry:
      geometry.type === "Polygon"
        ? { type: "MultiPolygon", coordinates: [geometry.coordinates] }
        : geometry,
    observedAt: properties.observedAt ?? null,
    unknownReason: properties.unknownReason ?? manifest.unknownReason,
    heightM,
    heightSource,
    heightIsEstimated,
    heightEstimationVersion,
  };
}

function normalizeRestSpot(
  feature: ParsedFeature,
  geometry: InputGeometry,
  manifest: Extract<ParsedManifest, { dataset: "REST_SPOT" }>,
  path: string,
  issues: SpatialAuditIssue[],
): NormalizedRestSpotFeature | null {
  if (geometry.type !== "Point") {
    issues.push(
      issue("INVALID_GEOMETRY_TYPE", `${path}.geometry`, "REST_SPOT requires Point geometry"),
    );
    return null;
  }
  const properties = feature.properties;
  if (!properties.restType) {
    issues.push(
      issue(
        "MISSING_REST_TYPE",
        `${path}.properties.restType`,
        "A supported rest type is required",
      ),
    );
    return null;
  }
  if (
    properties.heightM !== undefined ||
    properties.heightSource !== undefined ||
    properties.floorCount !== undefined ||
    properties.barrierType !== undefined ||
    properties.slopePercent !== undefined ||
    properties.slopeSource !== undefined
  ) {
    issues.push(
      issue(
        "IRRELEVANT_PROPERTIES",
        `${path}.properties`,
        "REST_SPOT contains properties for another dataset",
      ),
    );
    return null;
  }

  return {
    sourceFeatureId: properties.sourceFeatureId,
    geometry,
    observedAt: properties.observedAt ?? null,
    unknownReason: properties.unknownReason ?? manifest.unknownReason,
    restType: properties.restType,
  };
}

function normalizeBarrier(
  feature: ParsedFeature,
  geometry: InputGeometry,
  manifest: Extract<ParsedManifest, { dataset: "BARRIER" }>,
  path: string,
  issues: SpatialAuditIssue[],
): NormalizedBarrierFeature | null {
  if (geometry.type === "Point") {
    issues.push(
      issue(
        "INVALID_GEOMETRY_TYPE",
        `${path}.geometry`,
        "BARRIER requires line or polygon geometry",
      ),
    );
    return null;
  }
  const properties = feature.properties;
  if (!properties.barrierType) {
    issues.push(
      issue(
        "MISSING_BARRIER_TYPE",
        `${path}.properties.barrierType`,
        "A supported barrier type is required",
      ),
    );
    return null;
  }
  if (
    properties.heightM !== undefined ||
    properties.heightSource !== undefined ||
    properties.floorCount !== undefined ||
    properties.restType !== undefined
  ) {
    issues.push(
      issue(
        "IRRELEVANT_PROPERTIES",
        `${path}.properties`,
        "BARRIER contains properties for another dataset",
      ),
    );
    return null;
  }

  if (properties.barrierType === "STAIRS") {
    if (properties.slopePercent !== undefined || properties.slopeSource !== undefined) {
      issues.push(
        issue(
          "INVALID_STAIRS_SLOPE",
          `${path}.properties`,
          "STAIRS evidence must not be represented as a DEM slope",
        ),
      );
      return null;
    }
    return {
      sourceFeatureId: properties.sourceFeatureId,
      geometry,
      observedAt: properties.observedAt ?? null,
      unknownReason: properties.unknownReason ?? manifest.unknownReason,
      barrierType: "STAIRS",
      slopePercent: null,
      slopeSource: null,
    };
  }

  if (!(properties.slopePercent !== undefined && properties.slopePercent > 5)) {
    issues.push(
      issue(
        "INVALID_SLOPE",
        `${path}.properties.slopePercent`,
        "Only DEM slopes greater than 5% are barrier evidence",
      ),
    );
    return null;
  }
  if (!properties.slopeSource) {
    issues.push(
      issue(
        "MISSING_SLOPE_PROVENANCE",
        `${path}.properties.slopeSource`,
        "A DEM slope source is required",
      ),
    );
    return null;
  }

  return {
    sourceFeatureId: properties.sourceFeatureId,
    geometry,
    observedAt: properties.observedAt ?? null,
    unknownReason: properties.unknownReason ?? manifest.unknownReason,
    barrierType: "STEEP_SLOPE",
    slopePercent: properties.slopePercent,
    slopeSource: properties.slopeSource,
  };
}

function normalizedDuplicateKey(
  dataset: SpatialDataset,
  feature: NormalizedSpatialFeature,
): string {
  const discriminatingValues =
    dataset === "BUILDING"
      ? {
          heightM: (feature as NormalizedBuildingFeature).heightM,
          heightSource: (feature as NormalizedBuildingFeature).heightSource,
        }
      : dataset === "REST_SPOT"
        ? { restType: (feature as NormalizedRestSpotFeature).restType }
        : {
            barrierType: (feature as NormalizedBarrierFeature).barrierType,
            slopePercent: (feature as NormalizedBarrierFeature).slopePercent,
          };
  return createHash("sha256")
    .update(JSON.stringify({ dataset, geometry: feature.geometry, ...discriminatingValues }))
    .digest("hex");
}

function normalizedFeature(
  feature: ParsedFeature,
  geometry: InputGeometry,
  manifest: ParsedManifest,
  path: string,
  issues: SpatialAuditIssue[],
): NormalizedSpatialFeature | null {
  switch (manifest.dataset) {
    case "BUILDING":
      return normalizeBuilding(feature, geometry, manifest, path, issues);
    case "REST_SPOT":
      return normalizeRestSpot(feature, geometry, manifest, path, issues);
    case "BARRIER":
      return normalizeBarrier(feature, geometry, manifest, path, issues);
  }
}

export function prepareSpatialImport(
  input: unknown,
  auditedAt = new Date(),
): SpatialImportPreparation {
  if (!Number.isFinite(auditedAt.getTime())) throw new Error("auditedAt must be a valid Date");
  const parsed = spatialImportInputSchema.safeParse(input);
  if (!parsed.success) {
    const audit = auditSkeleton(auditedAt);
    return {
      ok: false,
      audit: {
        ...audit,
        issues: parsed.error.issues.map((entry) =>
          issue("INVALID_INPUT", entry.path.join("."), entry.message),
        ),
      },
    };
  }

  const { manifest, geojson } = parsed.data;
  const issues: SpatialAuditIssue[] = [];
  const featureCount = geojson.features.length;
  if (!SUPPORTED_SOURCE_CRS.has(manifest.sourceCrs as SupportedCrs)) {
    issues.push(
      issue(
        "UNSUPPORTED_CRS",
        "manifest.sourceCrs",
        "The declared source CRS is not in the explicit transform allow-list",
      ),
    );
  }
  if (
    (manifest.coverage === "COMMUNITY_PARTIAL" || manifest.confidence === "UNKNOWN") &&
    !manifest.unknownReason
  ) {
    issues.push(
      issue(
        "MISSING_UNKNOWN_REASON",
        "manifest.unknownReason",
        "Partial or unknown evidence requires an explicit limitation",
      ),
    );
  }

  const sourceUpdatedAt = new Date(manifest.datasetUpdatedAt);
  const datasetAgeMs = auditedAt.getTime() - sourceUpdatedAt.getTime();
  if (datasetAgeMs < 0) {
    issues.push(
      issue(
        "FUTURE_DATASET_DATE",
        "manifest.datasetUpdatedAt",
        "Dataset reference date cannot be after the audit time",
      ),
    );
  } else if (datasetAgeMs > manifest.quality.maxDatasetAgeDays * 86_400_000) {
    issues.push(
      issue(
        "STALE_DATASET",
        "manifest.datasetUpdatedAt",
        "Dataset reference date exceeds the declared maximum age",
      ),
    );
  }

  const coverage = manifest.coverageGeometry as PolygonGeometry | MultiPolygonGeometry;
  if (!isValidGeometry(coverage)) {
    issues.push(
      issue(
        "INVALID_COVERAGE_GEOMETRY",
        "manifest.coverageGeometry",
        "Coverage geometry must be a valid closed polygon",
      ),
    );
  }
  if (!isInsideDaeguDefensiveExtent(coverage)) {
    issues.push(
      issue(
        "COVERAGE_OUTSIDE_DAEGU",
        "manifest.coverageGeometry",
        "Coverage geometry must remain inside the Daegu defensive extent",
      ),
    );
  }

  const normalized: NormalizedSpatialFeature[] = [];
  const sourceFeatureIds = new Set<string>();
  const duplicateKeys = new Set<string>();
  const duplicateIndexes = new Set<number>();

  for (const [index, feature] of geojson.features.entries()) {
    const path = `geojson.features.${index}`;
    if (sourceFeatureIds.has(feature.properties.sourceFeatureId)) {
      issues.push(
        issue(
          "DUPLICATE_SOURCE_ID",
          `${path}.properties.sourceFeatureId`,
          "Source feature IDs must be unique within a release",
        ),
      );
      duplicateIndexes.add(index);
    }
    sourceFeatureIds.add(feature.properties.sourceFeatureId);

    if (!SUPPORTED_SOURCE_CRS.has(manifest.sourceCrs as SupportedCrs)) continue;
    const geometry = transformGeometryToWgs84(
      feature.geometry as InputGeometry,
      manifest.sourceCrs as SupportedCrs,
    );
    if (!isValidGeometry(geometry)) {
      issues.push(
        issue(
          "INVALID_GEOMETRY",
          `${path}.geometry`,
          "Feature geometry is empty, open, or topologically invalid",
        ),
      );
      continue;
    }
    if (!isInsideDaeguDefensiveExtent(geometry) || !isWithinCoverage(geometry, coverage)) {
      issues.push(
        issue(
          "OUTSIDE_COVERAGE",
          `${path}.geometry`,
          "Feature is outside the declared Daegu coverage geometry",
        ),
      );
      continue;
    }

    const preparedFeature = normalizedFeature(feature, geometry, manifest, path, issues);
    if (!preparedFeature) continue;
    const duplicateKey = normalizedDuplicateKey(manifest.dataset, preparedFeature);
    if (duplicateKeys.has(duplicateKey)) duplicateIndexes.add(index);
    duplicateKeys.add(duplicateKey);
    normalized.push(preparedFeature);
  }

  const duplicateRate = featureCount === 0 ? 0 : duplicateIndexes.size / featureCount;
  if (duplicateRate > manifest.quality.maxDuplicateRate) {
    issues.push(
      issue(
        "DUPLICATE_RATE_EXCEEDED",
        "geojson.features",
        "Normalized duplicate rate exceeds the manifest threshold",
      ),
    );
  }

  const audit: SpatialImportAudit = {
    schemaVersion: 1,
    ok: issues.length === 0,
    auditedAt: auditedAt.toISOString(),
    dataset: manifest.dataset,
    version: manifest.version,
    featureCount,
    acceptedCount: normalized.length,
    duplicateRate,
    issues,
  };
  if (!audit.ok) return { ok: false, audit };

  const successfulAudit: SpatialImportAudit = { ...audit, ok: true };
  return {
    ok: true,
    audit: successfulAudit,
    payload: { manifest, features: normalized, audit: successfulAudit },
  };
}

const rpcResponseSchema = z
  .object({
    releaseId: z.string().uuid(),
    dataset: z.enum(["BUILDING", "REST_SPOT", "BARRIER"]),
    version: requiredText,
    featureCount: z.number().int().nonnegative(),
    active: z.literal(true),
  })
  .strict();

export interface SpatialImportApplyOptions {
  readonly supabaseUrl: string;
  readonly secretKey: string;
  readonly fetcher?: typeof fetch;
}

function isLegacyJwtApiKey(value: string): boolean {
  const segments = value.split(".");
  return segments.length === 3 && segments.every((segment) => segment.length > 0);
}

export async function applySpatialImport(
  payload: SpatialImportPayload,
  options: SpatialImportApplyOptions,
): Promise<z.infer<typeof rpcResponseSchema>> {
  if (!payload.audit.ok || payload.audit.featureCount !== payload.features.length) {
    throw new Error("Only a complete, successful spatial audit can be applied");
  }
  const url = new URL(options.supabaseUrl);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Supabase URL must be an HTTPS project root URL");
  }
  if (!options.secretKey.trim()) throw new Error("Supabase secret key is required");

  const response = await (options.fetcher ?? fetch)(
    `${url.origin}/rest/v1/rpc/import_phase6_spatial_release`,
    {
      method: "POST",
      headers: {
        apikey: options.secretKey,
        ...(isLegacyJwtApiKey(options.secretKey)
          ? { Authorization: `Bearer ${options.secretKey}` }
          : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_manifest: payload.manifest,
        p_features: payload.features,
        p_audit: payload.audit,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Spatial import RPC failed (HTTP ${response.status})`);
  }
  return rpcResponseSchema.parse(await response.json());
}

interface CliOptions {
  readonly manifestPath: string;
  readonly geojsonPath: string;
  readonly mode: "dry-run" | "apply";
  readonly auditOutputPath?: string;
  readonly auditedAt: Date;
}

function parseCliOptions(arguments_: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  let mode: CliOptions["mode"] | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run" || argument === "--apply") {
      if (mode) throw new Error("Choose exactly one of --dry-run or --apply");
      mode = argument === "--apply" ? "apply" : "dry-run";
      continue;
    }
    if (!["--manifest", "--geojson", "--audit-out", "--audited-at"].includes(argument ?? "")) {
      throw new Error("Unknown spatial import argument");
    }
    const value = arguments_[index + 1];
    if (!argument || !value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument ?? "argument"}`);
    }
    if (values.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
    values.set(argument, value);
    index += 1;
  }

  const manifestPath = values.get("--manifest");
  const geojsonPath = values.get("--geojson");
  const auditedAt = new Date(values.get("--audited-at") ?? new Date().toISOString());
  if (!manifestPath || !geojsonPath || !mode || !Number.isFinite(auditedAt.getTime())) {
    throw new Error(
      "Usage: bun scripts/import-spatial-data.ts --manifest <file> --geojson <file> --dry-run|--apply [--audit-out <file>] [--audited-at <ISO>]",
    );
  }

  const auditOutputPath = values.get("--audit-out");
  return {
    manifestPath,
    geojsonPath,
    mode,
    auditedAt,
    ...(auditOutputPath ? { auditOutputPath } : {}),
  };
}

async function writeAudit(audit: SpatialImportAudit, outputPath?: string): Promise<void> {
  const serialized = `${JSON.stringify(audit, null, 2)}\n`;
  if (!outputPath) {
    console.log(serialized.trimEnd());
    return;
  }
  const resolvedPath = resolve(outputPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, serialized, "utf8");
}

async function runCli(arguments_: readonly string[]): Promise<void> {
  const options = parseCliOptions(arguments_);
  const [manifest, geojson] = await Promise.all([
    readFile(resolve(options.manifestPath), "utf8").then((value) => JSON.parse(value) as unknown),
    readFile(resolve(options.geojsonPath), "utf8").then((value) => JSON.parse(value) as unknown),
  ]);
  const prepared = prepareSpatialImport({ manifest, geojson }, options.auditedAt);
  await writeAudit(prepared.audit, options.auditOutputPath);
  if (!prepared.ok) throw new Error("Spatial import audit failed; no database changes were made");
  if (options.mode === "dry-run") return;

  const environment = z
    .object({ SUPABASE_URL: z.string().url(), SUPABASE_SECRET_KEY: requiredText })
    .strict()
    .parse({
      SUPABASE_URL: process.env["SUPABASE_URL"],
      SUPABASE_SECRET_KEY: process.env["SUPABASE_SECRET_KEY"],
    });
  const result = await applySpatialImport(prepared.payload, {
    supabaseUrl: environment.SUPABASE_URL,
    secretKey: environment.SUPABASE_SECRET_KEY,
  });
  console.log(
    `Spatial import activated ${result.dataset} ${result.version} (${result.featureCount} features).`,
  );
}

async function main(): Promise<void> {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected spatial import failure";
    console.error(`Spatial import failed: ${message}`);
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) void main();
