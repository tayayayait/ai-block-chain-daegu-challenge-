import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  booleanPointInPolygon,
  booleanWithin,
  feature as turfFeature,
  featureCollection,
  polygon,
  union,
} from "@turf/turf";
import { z } from "zod";

import { prepareSpatialImport, type SpatialImportAudit } from "./import-spatial-data.ts";

const overpassElementSchema = z
  .object({
    type: z.enum(["node", "way", "relation"]),
    id: z.number().int().nonnegative(),
  })
  .passthrough();

const overpassResponseSchema = z
  .object({
    version: z.union([z.literal(0.6), z.literal("0.6")]),
    generator: z.string().trim().min(1),
    osm3s: z
      .object({
        timestamp_osm_base: z.string().datetime({ offset: true }),
        copyright: z.string().trim().min(1),
      })
      .passthrough(),
    elements: z.array(overpassElementSchema),
  })
  .passthrough();

export type OverpassResponse = z.infer<typeof overpassResponseSchema>;

type Position = [longitude: number, latitude: number];
type CoverageGeometry =
  | { readonly type: "Polygon"; readonly coordinates: Position[][] }
  | { readonly type: "MultiPolygon"; readonly coordinates: Position[][][] };

interface RelationMember {
  readonly type: "node" | "way" | "relation";
  readonly ref: number;
  readonly role: string;
}

interface BoundaryWay {
  readonly id: number;
  readonly nodes: readonly number[];
  readonly coordinates: readonly Position[];
}

export type OsmSpatialDataset = "BUILDING" | "REST_SPOT" | "BARRIER";
export type OsmOverpassQuery = "BOUNDARY" | OsmSpatialDataset;

export const SERVICE_DISTRICT_RELATION_IDS = [
  3_891_544, // Dong-gu
  3_959_027, // Suseong-gu
  3_966_394, // Jung-gu
  3_966_426, // Buk-gu
  3_969_938, // Seo-gu
  3_970_414, // Dalseo-gu
  3_972_089, // Nam-gu
  3_972_253, // Dalseong-gun
] as const;

interface GeoJsonFeature {
  readonly type: "Feature";
  readonly geometry:
    | { readonly type: "Point"; readonly coordinates: Position }
    | { readonly type: "LineString"; readonly coordinates: Position[] }
    | { readonly type: "Polygon"; readonly coordinates: Position[][] };
  readonly properties: Readonly<Record<string, string | number>>;
}

export interface NormalizedOsmArtifacts {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly geojson: Readonly<{
    type: "FeatureCollection";
    features: readonly GeoJsonFeature[];
  }>;
  readonly counts: Readonly<{
    source: number;
    accepted: number;
    excluded: number;
    excludedByReason: Readonly<Record<string, number>>;
  }>;
}

interface OsmArtifactDatasetBundle {
  readonly query: string;
  readonly fetched: FetchedOverpassResponse;
  readonly artifacts: NormalizedOsmArtifacts;
  readonly audit: SpatialImportAudit;
}

export interface OsmArtifactBundle {
  readonly generatedAt: string;
  readonly boundary: Readonly<{
    query: string;
    fetched: FetchedOverpassResponse;
    coverageGeometry: CoverageGeometry;
  }>;
  readonly datasets: Readonly<Record<OsmSpatialDataset, OsmArtifactDatasetBundle>>;
}

export interface CollectOsmSpatialDataOptions {
  readonly auditedAt?: Date;
  readonly fetchQuery?: (query: string) => Promise<FetchedOverpassResponse>;
}

interface OsmProvenanceSource {
  readonly endpoint: string;
  readonly fetchedAt: string;
  readonly attempts: number;
  readonly osmBaseTimestamp: string;
  readonly generator: string;
  readonly query: string;
  readonly querySha256: string;
  readonly rawFile: string;
  readonly rawSha256: string;
  readonly rawBytes: number;
  readonly gzipSha256: string;
  readonly gzipBytes: number;
  readonly counts: Readonly<Record<string, unknown>>;
  readonly manifestVersion?: string;
}

export interface OsmArtifactProvenance {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly relationId: 2_395_674;
  readonly coverageRelationIds: typeof SERVICE_DISTRICT_RELATION_IDS;
  readonly licenseCode: "ODbL-1.0";
  readonly attribution: "© OpenStreetMap contributors, ODbL 1.0";
  readonly sources: Readonly<Record<"BOUNDARY" | OsmSpatialDataset, OsmProvenanceSource>>;
}

export interface FetchOverpassOptions {
  readonly endpoints?: readonly string[];
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly maxResponseBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface FetchedOverpassResponse {
  readonly document: OverpassResponse;
  readonly rawBytes: Uint8Array;
  readonly endpoint: string;
  readonly attempts: number;
  readonly fetchedAt: string;
}

const DEFAULT_OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
] as const;
const OVERPASS_USER_AGENT =
  "Daegu Heat Safety Spatial ETL/1.0 (OpenStreetMap community data import)";

class PermanentOverpassError extends Error {}

export function parseOverpassResponse(value: unknown): OverpassResponse {
  const parsed = overpassResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid Overpass JSON envelope: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  if ("remark" in parsed.data) {
    throw new Error("Overpass returned a remark; refusing a potentially partial response");
  }
  return parsed.data;
}

async function readResponseWithCeiling(
  response: Response,
  maxResponseBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const byteLength = Number(declaredLength);
    if (Number.isFinite(byteLength) && byteLength > maxResponseBytes) {
      throw new PermanentOverpassError(
        `Overpass response exceeds byte ceiling (${String(byteLength)} > ${String(maxResponseBytes)})`,
      );
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel("response byte ceiling exceeded");
        throw new PermanentOverpassError(
          `Overpass response exceeds byte ceiling (${String(totalBytes)} > ${String(maxResponseBytes)})`,
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export async function fetchOverpassJson(
  query: string,
  options: FetchOverpassOptions = {},
): Promise<FetchedOverpassResponse> {
  const endpoints = options.endpoints ?? DEFAULT_OVERPASS_ENDPOINTS;
  const maxAttempts = options.maxAttempts ?? 4;
  const initialBackoffMs = options.initialBackoffMs ?? 1_000;
  const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024 * 1024;
  const requestTimeoutMs = options.requestTimeoutMs ?? 180_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  if (endpoints.length === 0) throw new PermanentOverpassError("At least one endpoint is required");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) {
    throw new PermanentOverpassError("maxAttempts must be an integer from 1 through 8");
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new PermanentOverpassError("maxResponseBytes must be a positive integer");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const endpoint = endpoints[(attempt - 1) % endpoints.length];
    if (!endpoint) throw new PermanentOverpassError("Endpoint selection failed");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": OVERPASS_USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = `Overpass HTTP ${String(response.status)} from ${endpoint}`;
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
          throw new PermanentOverpassError(message);
        }
        throw new Error(message);
      }
      const rawBytes = await readResponseWithCeiling(response, maxResponseBytes);
      let decoded: unknown;
      try {
        decoded = JSON.parse(new TextDecoder().decode(rawBytes));
      } catch {
        throw new PermanentOverpassError("Overpass response is not valid JSON");
      }
      let document: OverpassResponse;
      try {
        document = parseOverpassResponse(decoded);
      } catch (error) {
        if (error instanceof Error && error.message.includes("remark")) throw error;
        throw new PermanentOverpassError(
          error instanceof Error ? error.message : "Invalid Overpass JSON envelope",
        );
      }
      return {
        document,
        rawBytes,
        endpoint,
        attempts: attempt,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error;
      if (error instanceof PermanentOverpassError || attempt === maxAttempts) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await sleep(initialBackoffMs * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error("Overpass request failed");
}

function readRelationMembers(value: unknown): RelationMember[] {
  const result = z
    .array(
      z
        .object({
          type: z.enum(["node", "way", "relation"]),
          ref: z.number().int().nonnegative(),
          role: z.string(),
        })
        .passthrough(),
    )
    .safeParse(value);
  if (!result.success) throw new Error("Daegu relation has invalid members");
  return result.data;
}

function readBoundaryWay(element: Record<string, unknown>): BoundaryWay {
  const parsed = z
    .object({
      id: z.number().int().nonnegative(),
      nodes: z.array(z.number().int().nonnegative()).min(2),
      geometry: z
        .array(z.object({ lat: z.number().finite(), lon: z.number().finite() }).strict())
        .min(2),
    })
    .passthrough()
    .safeParse(element);
  if (!parsed.success || parsed.data.nodes.length !== parsed.data.geometry.length) {
    throw new Error(`Boundary way ${String(element["id"])} has incomplete geometry`);
  }
  return {
    id: parsed.data.id,
    nodes: parsed.data.nodes,
    coordinates: parsed.data.geometry.map(({ lon, lat }) => [lon, lat]),
  };
}

function reverseWay(way: BoundaryWay): BoundaryWay {
  return {
    id: way.id,
    nodes: [...way.nodes].reverse(),
    coordinates: [...way.coordinates].reverse(),
  };
}

function stitchOuterWays(ways: readonly BoundaryWay[]): Position[][] {
  const remaining = new Map(ways.map((way) => [way.id, way]));
  const rings: Position[][] = [];

  while (remaining.size > 0) {
    const first = [...remaining.values()].sort((left, right) => left.id - right.id)[0];
    if (!first) break;
    remaining.delete(first.id);
    let nodes = [...first.nodes];
    let coordinates = [...first.coordinates];

    while (nodes.at(-1) !== nodes[0]) {
      const currentNode = nodes.at(-1);
      const candidates = [...remaining.values()].filter(
        (way) => way.nodes[0] === currentNode || way.nodes.at(-1) === currentNode,
      );
      if (candidates.length === 0) {
        throw new Error(`Daegu outer boundary is open at node ${String(currentNode)}`);
      }
      if (candidates.length > 1) {
        throw new Error(`Daegu outer boundary is ambiguous at node ${String(currentNode)}`);
      }
      const candidate = candidates[0];
      if (!candidate) throw new Error("Daegu outer boundary continuation disappeared");
      remaining.delete(candidate.id);
      const oriented = candidate.nodes[0] === currentNode ? candidate : reverseWay(candidate);
      nodes = [...nodes, ...oriented.nodes.slice(1)];
      coordinates = [...coordinates, ...oriented.coordinates.slice(1)];
    }

    if (coordinates.length < 4) throw new Error("Daegu outer boundary ring is too short");
    rings.push(coordinates);
  }
  if (rings.length === 0) throw new Error("Daegu relation has no assembled outer boundary");
  return rings;
}

export function assembleDaeguBoundary(response: OverpassResponse): CoverageGeometry {
  const relations = response.elements.filter(
    (element) => element.type === "relation" && element.id === 2_395_674,
  );
  if (relations.length !== 1) {
    throw new Error("Expected exactly one Daegu relation 2395674");
  }
  const relation = relations[0] as Record<string, unknown>;
  const tags = relation["tags"];
  if (
    !tags ||
    typeof tags !== "object" ||
    (tags as Record<string, unknown>)["boundary"] !== "administrative"
  ) {
    throw new Error("Daegu relation is not an administrative boundary");
  }
  const members = readRelationMembers(relation["members"]);
  if (members.some((member) => member.role === "inner")) {
    throw new Error("Daegu relation contains an inner boundary; unsupported fail-closed case");
  }
  for (const member of members) {
    const allowed =
      (member.type === "way" && member.role === "outer") ||
      (member.type === "relation" && member.role === "subarea") ||
      (member.type === "node" && member.role === "admin_centre");
    if (!allowed) {
      throw new Error(
        `Daegu relation contains ambiguous member ${member.type}/${member.role || "empty-role"}`,
      );
    }
  }

  const outerIds = new Set(
    members
      .filter((member) => member.type === "way" && member.role === "outer")
      .map((member) => member.ref),
  );
  const wayElements = response.elements.filter(
    (element) => element.type === "way" && outerIds.has(element.id),
  );
  if (wayElements.length !== outerIds.size) {
    throw new Error("Daegu boundary response is missing one or more declared outer ways");
  }
  const rings = stitchOuterWays(
    wayElements.map((element) => readBoundaryWay(element as Record<string, unknown>)),
  );
  return rings.length === 1
    ? { type: "Polygon", coordinates: [rings[0] as Position[]] }
    : { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
}

function outerRingsForAdministrativeRelation(
  response: OverpassResponse,
  relationId: number,
  allowedRelationRoles: ReadonlySet<string> = new Set(["subarea"]),
): Position[][] {
  const relations = response.elements.filter(
    (element) => element.type === "relation" && element.id === relationId,
  );
  if (relations.length !== 1) {
    throw new Error(`Expected exactly one administrative relation ${String(relationId)}`);
  }
  const relation = relations[0] as Record<string, unknown>;
  const tags = tagsOf(relation);
  if (tags["boundary"] !== "administrative") {
    throw new Error(`Relation ${String(relationId)} is not an administrative boundary`);
  }
  const members = readRelationMembers(relation["members"]);
  if (members.some((member) => member.role === "inner")) {
    throw new Error(
      `Relation ${String(relationId)} contains an inner boundary; unsupported fail-closed case`,
    );
  }
  for (const member of members) {
    const allowed =
      (member.type === "way" && member.role === "outer") ||
      (member.type === "node" && ["admin_centre", "label"].includes(member.role)) ||
      (member.type === "relation" && allowedRelationRoles.has(member.role));
    if (!allowed) {
      throw new Error(
        `Relation ${String(relationId)} contains ambiguous member ${member.type}/${member.role || "empty-role"}`,
      );
    }
  }
  const outerIds = new Set(
    members
      .filter((member) => member.type === "way" && member.role === "outer")
      .map((member) => member.ref),
  );
  const wayElements = response.elements.filter(
    (element) => element.type === "way" && outerIds.has(element.id),
  );
  if (wayElements.length !== outerIds.size) {
    throw new Error(`Boundary response is incomplete for relation ${String(relationId)}`);
  }
  return stitchOuterWays(
    wayElements.map((element) => readBoundaryWay(element as Record<string, unknown>)),
  );
}

export function assembleServiceCoverageBoundary(response: OverpassResponse): CoverageGeometry {
  const rings = SERVICE_DISTRICT_RELATION_IDS.flatMap((relationId) =>
    outerRingsForAdministrativeRelation(response, relationId),
  );
  const merged = union(featureCollection(rings.map((ring) => polygon([ring]))));
  if (!merged) throw new Error("Eight-district service coverage union is empty");
  if (merged.geometry.type !== "Polygon" && merged.geometry.type !== "MultiPolygon") {
    throw new Error("Eight-district service coverage union returned an invalid geometry type");
  }
  return merged.geometry as CoverageGeometry;
}

function tagsOf(element: Record<string, unknown>): Record<string, string> {
  const tags = element["tags"];
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) return {};
  return Object.fromEntries(
    Object.entries(tags).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function observedAtOf(element: Record<string, unknown>): string | undefined {
  const parsed = z.string().datetime({ offset: true }).safeParse(element["timestamp"]);
  return parsed.success ? parsed.data : undefined;
}

function strictHeightMeters(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)(?:\s*m)?$/u.exec(value.trim());
  if (!match?.[1]) return null;
  const height = Number(match[1]);
  return Number.isFinite(height) && height > 0 && height <= 1_000 ? height : null;
}

function strictPositiveLevels(value: string | undefined): number | null {
  if (!value || !/^[1-9][0-9]*$/u.test(value.trim())) return null;
  const levels = Number(value.trim());
  return Number.isSafeInteger(levels) && levels <= 333 ? levels : null;
}

function wayLineGeometry(element: Record<string, unknown>): {
  nodes: number[];
  coordinates: Position[];
} | null {
  const parsed = z
    .object({
      nodes: z.array(z.number().int().nonnegative()).min(2),
      geometry: z
        .array(z.object({ lat: z.number().finite(), lon: z.number().finite() }).strict())
        .min(2),
    })
    .passthrough()
    .safeParse(element);
  if (!parsed.success || parsed.data.nodes.length !== parsed.data.geometry.length) return null;
  return {
    nodes: parsed.data.nodes,
    coordinates: parsed.data.geometry.map(({ lon, lat }) => [lon, lat]),
  };
}

function incrementCount(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function isFeatureWithinCoverage(
  feature: GeoJsonFeature,
  coverageGeometry: CoverageGeometry,
): boolean {
  try {
    const coverage = turfFeature(coverageGeometry as never);
    const candidate = turfFeature(feature.geometry as never);
    return feature.geometry.type === "Point"
      ? booleanPointInPolygon(candidate as never, coverage as never, { ignoreBoundary: false })
      : booleanWithin(candidate as never, coverage as never);
  } catch {
    return false;
  }
}

function featureProperties(
  sourceFeatureId: string,
  observedAt: string | undefined,
  values: Record<string, string | number>,
): Record<string, string | number> {
  return observedAt ? { sourceFeatureId, observedAt, ...values } : { sourceFeatureId, ...values };
}

function normalizeBuilding(element: Record<string, unknown>): {
  feature?: GeoJsonFeature;
  excluded?: string;
} {
  if (element["type"] !== "way") return { excluded: "NON_WAY_BUILDING" };
  const tags = tagsOf(element);
  if (!tags["building"]) return { excluded: "NOT_BUILDING_WAY" };
  const way = wayLineGeometry(element);
  if (!way) return { excluded: "INVALID_WAY_GEOMETRY" };
  const firstNode = way.nodes[0];
  const lastNode = way.nodes.at(-1);
  const firstPosition = way.coordinates[0];
  const lastPosition = way.coordinates.at(-1);
  if (
    way.coordinates.length < 4 ||
    firstNode !== lastNode ||
    !firstPosition ||
    !lastPosition ||
    firstPosition[0] !== lastPosition[0] ||
    firstPosition[1] !== lastPosition[1]
  ) {
    return { excluded: "OPEN_BUILDING_WAY" };
  }
  const heightM = strictHeightMeters(tags["height"]);
  const floorCount = strictPositiveLevels(tags["building:levels"]);
  if (heightM === null && floorCount === null) {
    return { excluded: "INVALID_HEIGHT_AND_LEVELS" };
  }
  const values =
    heightM === null
      ? { floorCount: floorCount as number }
      : { heightM, heightSource: "OSM_HEIGHT_TAG" };
  return {
    feature: {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [way.coordinates] },
      properties: featureProperties(
        `osm-way-${String(element["id"])}`,
        observedAtOf(element),
        values,
      ),
    },
  };
}

const SHELTER_REST_TYPES: Readonly<Record<string, "PAVILION" | "SHADE_CANOPY">> = {
  picnic_shelter: "PAVILION",
  pavilion: "PAVILION",
  gazebo: "PAVILION",
  sun_shelter: "SHADE_CANOPY",
  weather_shelter: "SHADE_CANOPY",
};

function normalizeRestSpot(element: Record<string, unknown>): {
  feature?: GeoJsonFeature;
  excluded?: string;
} {
  if (element["type"] !== "node") return { excluded: "NON_NODE_REST_SPOT" };
  const tags = tagsOf(element);
  const restType =
    tags["amenity"] === "bench"
      ? "BENCH"
      : tags["amenity"] === "shelter"
        ? SHELTER_REST_TYPES[tags["shelter_type"] ?? ""]
        : undefined;
  if (!restType) {
    return {
      excluded: tags["amenity"] === "shelter" ? "SHELTER_TYPE_NOT_ALLOWED" : "NOT_REST_SPOT",
    };
  }
  const coordinate = z
    .object({ lat: z.number().finite(), lon: z.number().finite() })
    .passthrough()
    .safeParse(element);
  if (!coordinate.success) return { excluded: "INVALID_NODE_COORDINATE" };
  return {
    feature: {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [coordinate.data.lon, coordinate.data.lat],
      },
      properties: featureProperties(`osm-node-${String(element["id"])}`, observedAtOf(element), {
        restType,
      }),
    },
  };
}

function normalizeBarrier(element: Record<string, unknown>): {
  feature?: GeoJsonFeature;
  excluded?: string;
} {
  if (element["type"] !== "way" || tagsOf(element)["highway"] !== "steps") {
    return { excluded: "NOT_STEPS_WAY" };
  }
  const way = wayLineGeometry(element);
  if (!way) return { excluded: "INVALID_WAY_GEOMETRY" };
  return {
    feature: {
      type: "Feature",
      geometry: { type: "LineString", coordinates: way.coordinates },
      properties: featureProperties(`osm-way-${String(element["id"])}`, observedAtOf(element), {
        barrierType: "STAIRS",
      }),
    },
  };
}

function manifestForDataset(
  dataset: OsmSpatialDataset,
  response: OverpassResponse,
  coverageGeometry: CoverageGeometry,
  sourceSnapshotSha256?: string,
): Readonly<Record<string, unknown>> {
  if (sourceSnapshotSha256 && !/^[0-9a-f]{64}$/u.test(sourceSnapshotSha256)) {
    throw new Error("sourceSnapshotSha256 must be a lowercase SHA-256 hex digest");
  }
  const compactTimestamp = response.osm3s.timestamp_osm_base
    .replace(/[-:]/gu, "")
    .replace(".000", "");
  const confidence = dataset === "BUILDING" ? "DERIVED" : "COMMUNITY";
  const unknownReason = {
    BUILDING:
      "OpenStreetMap community coverage is incomplete; only closed ways with a strict height or positive integer building:levels tag are included.",
    REST_SPOT:
      "OpenStreetMap community coverage is incomplete; only mapped benches and explicitly supported shelter nodes are included, with no operating-status guarantee.",
    BARRIER:
      "OpenStreetMap community coverage is incomplete; mapped highway=steps ways are hazard evidence, while an absent tag is not evidence of a step-free route.",
  }[dataset];
  const base = {
    schemaVersion: 1,
    version: `osm-${dataset.toLowerCase().replace("_", "-")}-${compactTimestamp}${
      sourceSnapshotSha256 ? `-${sourceSnapshotSha256.slice(0, 12)}` : ""
    }`,
    dataset,
    sourceName: "OpenStreetMap via Overpass API (Daegu eight-district service coverage)",
    sourceUrl: "https://www.openstreetmap.org/relation/2395674",
    licenseCode: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors, ODbL 1.0",
    sourceCrs: "EPSG:4326",
    targetCrs: "EPSG:4326",
    coverageCrs: "EPSG:4326",
    datasetUpdatedAt: response.osm3s.timestamp_osm_base,
    coverage: "COMMUNITY_PARTIAL",
    confidence,
    unknownReason,
    coverageGeometry,
    quality: { maxDuplicateRate: 0.1, maxDatasetAgeDays: 30 },
  } as const;
  return dataset === "BUILDING"
    ? {
        ...base,
        rules: {
          kind: "BUILDING",
          allowFloorEstimate: true,
          floorHeightM: 3,
          heightEstimationVersion: "osm-building-levels-3m-v1",
        },
      }
    : { ...base, rules: { kind: dataset } };
}

export function normalizeOsmDataset(
  dataset: OsmSpatialDataset,
  response: OverpassResponse,
  coverageGeometry: CoverageGeometry,
  sourceSnapshotSha256?: string,
): NormalizedOsmArtifacts {
  const features: GeoJsonFeature[] = [];
  const excludedByReason: Record<string, number> = {};
  for (const sourceElement of response.elements) {
    const element = sourceElement as Record<string, unknown>;
    const normalized =
      dataset === "BUILDING"
        ? normalizeBuilding(element)
        : dataset === "REST_SPOT"
          ? normalizeRestSpot(element)
          : normalizeBarrier(element);
    if (normalized.feature && isFeatureWithinCoverage(normalized.feature, coverageGeometry)) {
      features.push(normalized.feature);
    } else if (normalized.feature) {
      incrementCount(excludedByReason, "OUTSIDE_SERVICE_COVERAGE");
    } else incrementCount(excludedByReason, normalized.excluded ?? "UNCLASSIFIED");
  }
  return {
    manifest: manifestForDataset(dataset, response, coverageGeometry, sourceSnapshotSha256),
    geojson: { type: "FeatureCollection", features },
    counts: {
      source: response.elements.length,
      accepted: features.length,
      excluded: response.elements.length - features.length,
      excludedByReason,
    },
  };
}

export function buildOverpassQuery(dataset: OsmOverpassQuery): string {
  const relationSelector = `rel(id:${SERVICE_DISTRICT_RELATION_IDS.join(",")})`;
  if (dataset === "BOUNDARY") {
    return `[out:json][timeout:120][maxsize:16777216];
${relationSelector}->.serviceDistricts;
(
  .serviceDistricts;
  way(r.serviceDistricts:"outer");
);
out meta geom;`;
  }

  const selector = {
    BUILDING: `(
  way["building"]["height"](area.searchArea);
  way["building"]["building:levels"](area.searchArea);
);`,
    REST_SPOT: `(
  node["amenity"="bench"](area.searchArea);
  node["amenity"="shelter"](area.searchArea);
);`,
    BARRIER: `way["highway"="steps"](area.searchArea);`,
  }[dataset];
  const output = dataset === "REST_SPOT" ? "out meta;" : "out meta geom;";
  return `[out:json][timeout:180][maxsize:67108864];
${relationSelector}->.serviceDistricts;
.serviceDistricts map_to_area -> .searchArea;
${selector}
${output}`;
}

function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeRawSnapshot(
  directory: string,
  name: string,
  query: string,
  fetched: FetchedOverpassResponse,
  counts: Readonly<Record<string, unknown>>,
  manifestVersion?: string,
): Promise<OsmProvenanceSource> {
  const gzipBytes = gzipSync(fetched.rawBytes, { level: 9 });
  const rawFile = `raw/${name}.json.gz`;
  await writeFile(join(directory, "raw", `${name}.json.gz`), gzipBytes);
  return {
    endpoint: fetched.endpoint,
    fetchedAt: fetched.fetchedAt,
    attempts: fetched.attempts,
    osmBaseTimestamp: fetched.document.osm3s.timestamp_osm_base,
    generator: fetched.document.generator,
    query,
    querySha256: sha256Hex(query),
    rawFile,
    rawSha256: sha256Hex(fetched.rawBytes),
    rawBytes: fetched.rawBytes.byteLength,
    gzipSha256: sha256Hex(gzipBytes),
    gzipBytes: gzipBytes.byteLength,
    counts,
    ...(manifestVersion ? { manifestVersion } : {}),
  };
}

export async function writeOsmArtifactBundle(
  outputDirectory: string,
  bundle: OsmArtifactBundle,
): Promise<Readonly<{ outputDirectory: string; provenance: OsmArtifactProvenance }>> {
  const finalDirectory = resolve(outputDirectory);
  if (await pathExists(finalDirectory)) {
    throw new Error(`Refusing to overwrite existing OSM artifact directory: ${finalDirectory}`);
  }
  await mkdir(dirname(finalDirectory), { recursive: true });
  const stagingDirectory = join(
    dirname(finalDirectory),
    `.${basename(finalDirectory)}.partial-${randomUUID()}`,
  );
  await mkdir(join(stagingDirectory, "raw"), { recursive: true });

  const sources = {} as Record<"BOUNDARY" | OsmSpatialDataset, OsmProvenanceSource>;
  sources.BOUNDARY = await writeRawSnapshot(
    stagingDirectory,
    "boundary",
    bundle.boundary.query,
    bundle.boundary.fetched,
    { source: bundle.boundary.fetched.document.elements.length },
  );

  for (const dataset of ["BUILDING", "REST_SPOT", "BARRIER"] as const) {
    const name = dataset.toLowerCase().replace("_", "-");
    const source = bundle.datasets[dataset];
    const manifestVersion = String(source.artifacts.manifest["version"]);
    sources[dataset] = await writeRawSnapshot(
      stagingDirectory,
      name,
      source.query,
      source.fetched,
      source.artifacts.counts,
      manifestVersion,
    );
    await writeFile(
      join(stagingDirectory, `${name}-manifest.json`),
      jsonBytes(source.artifacts.manifest),
    );
    await writeFile(
      join(stagingDirectory, `${name}-features.geojson`),
      jsonBytes(source.artifacts.geojson),
    );
    await writeFile(join(stagingDirectory, `${name}-audit.json`), jsonBytes(source.audit));
  }

  const provenance: OsmArtifactProvenance = {
    schemaVersion: 1,
    generatedAt: bundle.generatedAt,
    relationId: 2_395_674,
    coverageRelationIds: SERVICE_DISTRICT_RELATION_IDS,
    licenseCode: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors, ODbL 1.0",
    sources,
  };
  await writeFile(join(stagingDirectory, "provenance.json"), jsonBytes(provenance));
  await rename(stagingDirectory, finalDirectory);
  return { outputDirectory: finalDirectory, provenance };
}

export async function collectOsmSpatialData(
  options: CollectOsmSpatialDataOptions = {},
): Promise<OsmArtifactBundle> {
  if (options.auditedAt && Number.isNaN(options.auditedAt.getTime())) {
    throw new Error("auditedAt must be a valid Date");
  }
  const fetchQuery = options.fetchQuery ?? ((query: string) => fetchOverpassJson(query));

  const boundaryQuery = buildOverpassQuery("BOUNDARY");
  const boundaryFetched = await fetchQuery(boundaryQuery);
  const coverageGeometry = assembleServiceCoverageBoundary(boundaryFetched.document);
  const datasets = {} as Record<OsmSpatialDataset, OsmArtifactDatasetBundle>;

  for (const dataset of ["BUILDING", "REST_SPOT", "BARRIER"] as const) {
    const query = buildOverpassQuery(dataset);
    const fetched = await fetchQuery(query);
    const sourceSha256 = sha256Hex(fetched.rawBytes);
    const artifacts = normalizeOsmDataset(
      dataset,
      fetched.document,
      coverageGeometry,
      sourceSha256,
    );
    // A multi-request collection can cross an OSM replication tick. Audit each
    // response after it arrives rather than against the collection start time.
    const auditedAt = options.auditedAt ?? new Date();
    const prepared = prepareSpatialImport(
      { manifest: artifacts.manifest, geojson: artifacts.geojson },
      auditedAt,
    );
    if (!prepared.ok) {
      const codes = [...new Set(prepared.audit.issues.map(({ code }) => code))].join(",");
      throw new Error(`OSM ${dataset} artifact failed spatial dry-run: ${codes || "UNKNOWN"}`);
    }
    datasets[dataset] = { query, fetched, artifacts, audit: prepared.audit };
  }

  return {
    generatedAt: (options.auditedAt ?? new Date()).toISOString(),
    boundary: { query: boundaryQuery, fetched: boundaryFetched, coverageGeometry },
    datasets,
  };
}

function parseCliArguments(arguments_: readonly string[]): Readonly<{ outputDirectory: string }> {
  if (arguments_.length !== 2 || arguments_[0] !== "--output" || !arguments_[1]?.trim()) {
    throw new Error("Usage: node scripts/fetch-osm-spatial-data.ts --output <new-directory>");
  }
  return { outputDirectory: resolve(arguments_[1]) };
}

async function main(): Promise<void> {
  const { outputDirectory } = parseCliArguments(process.argv.slice(2));
  const bundle = await collectOsmSpatialData();
  const written = await writeOsmArtifactBundle(outputDirectory, bundle);
  const counts = Object.fromEntries(
    (["BUILDING", "REST_SPOT", "BARRIER"] as const).map((dataset) => [
      dataset,
      bundle.datasets[dataset].artifacts.counts.accepted,
    ]),
  );
  console.log(
    `OSM spatial artifacts verified and written: ${written.outputDirectory} (${JSON.stringify(counts)})`,
  );
}

const directEntry = process.argv[1];
if (directEntry && directEntry === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error(`OSM spatial collection failed: ${message}`);
    process.exitCode = 1;
  });
}
