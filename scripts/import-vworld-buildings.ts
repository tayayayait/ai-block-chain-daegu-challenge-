import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

import { z } from "zod";

const requiredText = z.string().trim().min(1).max(500);
const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const ringSchema = z.array(positionSchema).min(4);
const multiPolygonSchema = z
  .object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(ringSchema).min(1)).min(1),
  })
  .strict();

const vworldFeatureSchema = z
  .object({
    sourceFeatureId: requiredText,
    geometry: multiPolygonSchema,
    heightM: z.number().finite().positive().max(300),
    heightSource: z.enum(["VWORLD_GIS_BUILDING_A16", "DERIVED_A26_GROUND_FLOORS"]),
    heightIsEstimated: z.boolean(),
    heightEstimationVersion: z.literal("vworld-a26-3m-v1").nullable(),
    observedAt: z.string().datetime({ offset: true }),
    confidence: z.enum(["VERIFIED_SOURCE", "DERIVED"]),
    coverage: z.literal("DAEGU_ALL"),
    unknownReason: requiredText.nullable(),
  })
  .strict()
  .superRefine((feature, context) => {
    const validDirect =
      !feature.heightIsEstimated &&
      feature.heightSource === "VWORLD_GIS_BUILDING_A16" &&
      feature.heightM <= 200 &&
      feature.heightEstimationVersion === null &&
      feature.confidence === "VERIFIED_SOURCE" &&
      feature.unknownReason === null;
    const validEstimate =
      feature.heightIsEstimated &&
      feature.heightSource === "DERIVED_A26_GROUND_FLOORS" &&
      feature.heightEstimationVersion === "vworld-a26-3m-v1" &&
      feature.confidence === "DERIVED" &&
      feature.unknownReason !== null &&
      feature.heightM % 3 === 0;
    if (!validDirect && !validEstimate) {
      context.addIssue({ code: "custom", message: "Invalid VWorld height provenance" });
    }
  });

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    dataset: z.literal("BUILDING"),
    version: z.string().regex(/^vworld-daegu-\d{8}$/u),
    sourceName: requiredText,
    sourceUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith("https://www.vworld.kr/")),
    licenseCode: requiredText,
    attribution: requiredText,
    sourceCrs: z.literal("EPSG:5186"),
    targetCrs: z.literal("EPSG:4326"),
    datasetUpdatedAt: z.string().datetime({ offset: true }),
    coverage: z.literal("DAEGU_ALL"),
    confidence: z.literal("DERIVED"),
    unknownReason: requiredText,
    expectedFeatureCount: z.number().int().positive(),
    featureFormat: z.literal("NDJSON_GZIP"),
    rules: z
      .object({
        directHeightField: z.literal("A16"),
        floorCountField: z.literal("A26"),
        floorHeightM: z.literal(3),
        directHeightRangeM: z.tuple([z.literal(1), z.literal(200)]),
        heightEstimationVersion: z.literal("vworld-a26-3m-v1"),
      })
      .strict(),
  })
  .strict();

const auditSchema = z
  .object({
    schemaVersion: z.literal(1),
    ok: z.literal(true),
    sourceCrs: z.literal("EPSG:5186"),
    recordCount: z.number().int().positive(),
    acceptedCount: z.number().int().positive(),
    directHeightCount: z.number().int().nonnegative(),
    estimatedHeightCount: z.number().int().nonnegative(),
    missingHeightCount: z.number().int().nonnegative(),
    outsideDaeguCount: z.literal(0),
    invalidGeometryCount: z.literal(0),
    duplicateSourceIdCount: z.literal(0),
    deletedRecordCount: z.literal(0),
    districtCounts: z.record(z.string(), z.number().int().nonnegative()),
    sourceDateCounts: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

type VworldFeature = z.infer<typeof vworldFeatureSchema>;
type VworldManifest = z.infer<typeof manifestSchema>;
type VworldAudit = z.infer<typeof auditSchema>;

export interface VworldBundlePaths {
  readonly manifestPath: string;
  readonly auditPath: string;
  readonly featurePath: string;
}

export interface VworldBundleInspection {
  readonly manifest: VworldManifest;
  readonly audit: VworldAudit;
  readonly featureCount: number;
  readonly directHeightCount: number;
  readonly estimatedHeightCount: number;
  readonly batchCount: number;
}

export interface InspectVworldBuildingBundleOptions extends VworldBundlePaths {
  readonly batchSize?: number;
  readonly onBatch?: (features: readonly VworldFeature[]) => void | Promise<void>;
}

function validatedBatchSize(value = 500): number {
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new RangeError("VWORLD_BATCH_SIZE_MUST_BE_1_TO_500");
  }
  return value;
}

async function readMetadata(paths: VworldBundlePaths): Promise<{
  manifest: VworldManifest;
  audit: VworldAudit;
}> {
  const [manifest, audit] = await Promise.all([
    readFile(resolve(paths.manifestPath), "utf8").then((value) =>
      manifestSchema.parse(JSON.parse(value)),
    ),
    readFile(resolve(paths.auditPath), "utf8").then((value) =>
      auditSchema.parse(JSON.parse(value)),
    ),
  ]);
  if (
    manifest.expectedFeatureCount !== audit.acceptedCount ||
    audit.directHeightCount + audit.estimatedHeightCount !== audit.acceptedCount ||
    audit.acceptedCount + audit.missingHeightCount !== audit.recordCount
  ) {
    throw new Error("VWORLD_BUNDLE_AUDIT_MISMATCH");
  }
  return { manifest, audit };
}

async function* streamFeatureBatches(
  featurePath: string,
  batchSize: number,
): AsyncGenerator<readonly VworldFeature[]> {
  const source = createReadStream(resolve(featurePath));
  const gunzip = createGunzip();
  const lines = createInterface({ input: source.pipe(gunzip), crlfDelay: Infinity });
  let batch: VworldFeature[] = [];
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) throw new Error(`VWORLD_EMPTY_NDJSON_LINE_${lineNumber}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`VWORLD_INVALID_NDJSON_LINE_${lineNumber}`);
      }
      const result = vworldFeatureSchema.safeParse(parsed);
      if (!result.success) throw new Error(`VWORLD_INVALID_FEATURE_LINE_${lineNumber}`);
      batch.push(result.data);
      if (batch.length === batchSize) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
  } finally {
    lines.close();
    source.destroy();
    gunzip.destroy();
  }
}

export async function inspectVworldBuildingBundle(
  options: InspectVworldBuildingBundleOptions,
): Promise<VworldBundleInspection> {
  const batchSize = validatedBatchSize(options.batchSize);
  const { manifest, audit } = await readMetadata(options);
  let featureCount = 0;
  let directHeightCount = 0;
  let estimatedHeightCount = 0;
  let batchCount = 0;
  for await (const batch of streamFeatureBatches(options.featurePath, batchSize)) {
    batchCount += 1;
    featureCount += batch.length;
    for (const feature of batch) {
      if (feature.heightIsEstimated) estimatedHeightCount += 1;
      else directHeightCount += 1;
    }
    await options.onBatch?.(batch);
  }
  if (
    featureCount !== manifest.expectedFeatureCount ||
    directHeightCount !== audit.directHeightCount ||
    estimatedHeightCount !== audit.estimatedHeightCount
  ) {
    throw new Error("VWORLD_BUNDLE_COUNT_MISMATCH");
  }
  return {
    manifest,
    audit,
    featureCount,
    directHeightCount,
    estimatedHeightCount,
    batchCount,
  };
}

const beginResponseSchema = z
  .object({
    releaseId: z.string().uuid(),
    active: z.boolean(),
    loadedCount: z.number().int().nonnegative(),
    expectedCount: z.number().int().positive(),
  })
  .strict();
const appendResponseSchema = z
  .object({
    releaseId: z.string().uuid(),
    insertedCount: z.number().int().nonnegative(),
    loadedCount: z.number().int().nonnegative(),
    expectedCount: z.number().int().positive(),
  })
  .strict();
const finalizeResponseSchema = z
  .object({
    releaseId: z.string().uuid(),
    active: z.literal(true),
    featureCount: z.number().int().positive(),
  })
  .strict();

function isLegacyJwtApiKey(value: string): boolean {
  const segments = value.split(".");
  return segments.length === 3 && segments.every((segment) => segment.length > 0);
}

function validatedSupabaseOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Supabase URL must be an HTTPS project root URL");
  }
  return url.origin;
}

async function invokeRpc<T>(
  origin: string,
  secretKey: string,
  functionName: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(`${origin}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      ...(isLegacyJwtApiKey(secretKey) ? { Authorization: `Bearer ${secretKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${functionName} failed (HTTP ${response.status}): ${errorText}`);
  }
  return schema.parse(await response.json());
}

export interface ApplyVworldBuildingBundleOptions {
  readonly supabaseUrl: string;
  readonly secretKey: string;
  readonly batchSize?: number;
  readonly fetcher?: typeof fetch;
  readonly onProgress?: (
    progress: Readonly<{
      batch: number;
      batchCount: number;
      loadedCount: number;
      expectedCount: number;
    }>,
  ) => void;
}

export interface ApplyVworldBuildingBundleResult {
  readonly releaseId: string;
  readonly active: true;
  readonly featureCount: number;
  readonly batchCount: number;
}

export async function applyVworldBuildingBundle(
  paths: VworldBundlePaths,
  options: ApplyVworldBuildingBundleOptions,
): Promise<ApplyVworldBuildingBundleResult> {
  const batchSize = validatedBatchSize(options.batchSize);
  const inspection = await inspectVworldBuildingBundle({ ...paths, batchSize });
  const origin = validatedSupabaseOrigin(options.supabaseUrl);
  const secretKey = options.secretKey.trim();
  if (!secretKey) throw new Error("Supabase secret key is required");
  const fetcher = options.fetcher ?? fetch;
  const beginning = await invokeRpc(
    origin,
    secretKey,
    "begin_vworld_building_import",
    { p_manifest: inspection.manifest, p_audit: inspection.audit },
    beginResponseSchema,
    fetcher,
  );
  if (beginning.expectedCount !== inspection.featureCount) {
    throw new Error("VWORLD_REMOTE_EXPECTED_COUNT_MISMATCH");
  }
  if (beginning.active) {
    if (beginning.loadedCount !== inspection.featureCount) {
      throw new Error("VWORLD_ACTIVE_RELEASE_COUNT_MISMATCH");
    }
    return {
      releaseId: beginning.releaseId,
      active: true,
      featureCount: beginning.loadedCount,
      batchCount: 0,
    };
  }

  let batch = 0;
  for await (const features of streamFeatureBatches(paths.featurePath, batchSize)) {
    batch += 1;
    const appended = await invokeRpc(
      origin,
      secretKey,
      "append_vworld_building_import",
      { p_release_id: beginning.releaseId, p_features: features },
      appendResponseSchema,
      fetcher,
    );
    if (
      appended.releaseId !== beginning.releaseId ||
      appended.expectedCount !== inspection.featureCount ||
      appended.loadedCount > inspection.featureCount
    ) {
      throw new Error("VWORLD_REMOTE_BATCH_COUNT_MISMATCH");
    }
    options.onProgress?.({
      batch,
      batchCount: inspection.batchCount,
      loadedCount: appended.loadedCount,
      expectedCount: appended.expectedCount,
    });
  }

  const finalized = await invokeRpc(
    origin,
    secretKey,
    "finalize_vworld_building_import",
    { p_release_id: beginning.releaseId },
    finalizeResponseSchema,
    fetcher,
  );
  if (
    finalized.releaseId !== beginning.releaseId ||
    finalized.featureCount !== inspection.featureCount
  ) {
    throw new Error("VWORLD_REMOTE_FINAL_COUNT_MISMATCH");
  }
  return { ...finalized, batchCount: batch };
}

interface CliOptions extends VworldBundlePaths {
  readonly mode: "dry-run" | "apply";
  readonly batchSize: number;
}

export function parseVworldImportCliOptions(arguments_: readonly string[]): CliOptions {
  let mode: CliOptions["mode"] | undefined;
  let bundleDirectory: string | undefined;
  let batchSize = 500;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run" || argument === "--apply") {
      if (mode) throw new Error("Choose exactly one of --dry-run or --apply");
      mode = argument === "--apply" ? "apply" : "dry-run";
      continue;
    }
    if (argument !== "--bundle-dir" && argument !== "--batch-size") {
      throw new Error("Unknown VWorld import argument");
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (argument === "--bundle-dir") bundleDirectory = value;
    else batchSize = Number(value);
    index += 1;
  }
  if (!bundleDirectory || !mode) {
    throw new Error(
      "Usage: node scripts/import-vworld-buildings.ts --bundle-dir <dir> --dry-run|--apply [--batch-size 1..500]",
    );
  }
  validatedBatchSize(batchSize);
  const directory = resolve(bundleDirectory);
  return {
    manifestPath: resolve(directory, "vworld-daegu-buildings.manifest.json"),
    auditPath: resolve(directory, "vworld-daegu-buildings.audit.json"),
    featurePath: resolve(directory, "vworld-daegu-buildings.ndjson.gz"),
    mode,
    batchSize,
  };
}

async function runCli(arguments_: readonly string[]): Promise<void> {
  const options = parseVworldImportCliOptions(arguments_);
  const paths: VworldBundlePaths = options;
  const inspection = await inspectVworldBuildingBundle({ ...paths, batchSize: options.batchSize });
  console.log(
    `VWorld bundle verified: ${inspection.featureCount.toLocaleString("en-US")} buildings (${inspection.batchCount.toLocaleString("en-US")} batches).`,
  );
  if (options.mode === "dry-run") return;

  const environment = z
    .object({ SUPABASE_URL: z.string().url(), SUPABASE_SECRET_KEY: requiredText })
    .strict()
    .parse({
      SUPABASE_URL: process.env["SUPABASE_URL"],
      SUPABASE_SECRET_KEY: process.env["SUPABASE_SECRET_KEY"],
    });
  const result = await applyVworldBuildingBundle(paths, {
    supabaseUrl: environment.SUPABASE_URL,
    secretKey: environment.SUPABASE_SECRET_KEY,
    batchSize: options.batchSize,
    onProgress: ({ batch, batchCount, loadedCount, expectedCount }) => {
      if (batch === batchCount || batch % 25 === 0) {
        console.log(`Imported batch ${batch}/${batchCount}: ${loadedCount}/${expectedCount}`);
      }
    },
  });
  console.log(
    `VWorld release activated: ${result.releaseId} (${result.featureCount.toLocaleString("en-US")} buildings).`,
  );
}

async function main(): Promise<void> {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected VWorld import failure";
    console.error(`VWorld import failed: ${message}`);
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) void main();
