import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { assertShelterInvariants, type ShelterFeatureCollection } from "./prepare-shelters.ts";

const EXPECTED_SHELTER_COUNT = 950;

export interface ShelterImportRow {
  readonly id: string;
  readonly name: string;
  readonly gu: string;
  readonly facility_type: string;
  readonly is_im_bank: boolean;
  readonly road_address: string;
  readonly location: string;
  readonly kma_nx: number;
  readonly kma_ny: number;
  readonly source_geo_idn: string;
  readonly geocode_result: string;
  readonly imported_at: string;
  readonly updated_at: string;
}

export interface PreparedShelterImport {
  readonly importedAt: string;
  readonly rows: readonly ShelterImportRow[];
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ShelterImportApplyOptions {
  readonly supabaseUrl: string;
  readonly secretKey: string;
  readonly fetcher?: Fetcher;
}

function postgisPoint(longitude: number, latitude: number): string {
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error("Shelter import contains an invalid WGS84 point");
  }
  return `POINT(${longitude} ${latitude})`;
}

export function prepareShelterImport(
  collection: ShelterFeatureCollection,
  importedAt: Date,
): PreparedShelterImport {
  assertShelterInvariants(collection);
  if (!Number.isFinite(importedAt.getTime())) {
    throw new Error("Shelter import timestamp is invalid");
  }

  const timestamp = importedAt.toISOString();
  const rows = collection.features.map((feature): ShelterImportRow => {
    const [longitude, latitude] = feature.geometry.coordinates;
    const properties = feature.properties;
    return Object.freeze({
      id: properties.id,
      name: properties.name,
      gu: properties.gu,
      facility_type: properties.facility_type,
      is_im_bank: properties.is_im_bank,
      road_address: properties.road_address,
      location: postgisPoint(longitude, latitude),
      kma_nx: properties.kma_nx,
      kma_ny: properties.kma_ny,
      source_geo_idn: properties.source_geo_idn,
      geocode_result: properties.geocode_result,
      imported_at: timestamp,
      updated_at: timestamp,
    });
  });

  return Object.freeze({ importedAt: timestamp, rows: Object.freeze(rows) });
}

function projectOrigin(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".supabase.co") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Supabase URL must be an HTTPS project root URL");
  }
  return url.origin;
}

function exactCount(response: Response): number {
  const contentRange = response.headers.get("content-range");
  const match = contentRange?.match(/\/(\d+)$/u);
  const count = match ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(count)) {
    throw new Error("Shelter import count verification did not return an exact count");
  }
  return count;
}

export async function applyShelterImport(
  prepared: PreparedShelterImport,
  options: ShelterImportApplyOptions,
): Promise<Readonly<{ importedCount: number; verifiedCount: number }>> {
  if (prepared.rows.length !== EXPECTED_SHELTER_COUNT) {
    throw new Error(`Shelter import must contain exactly ${EXPECTED_SHELTER_COUNT} rows`);
  }
  if (!options.secretKey.trim()) throw new Error("Supabase secret key is required");

  const origin = projectOrigin(options.supabaseUrl);
  const fetcher = options.fetcher ?? fetch;
  const authorizationHeaders = {
    apikey: options.secretKey,
    Authorization: `Bearer ${options.secretKey}`,
  } as const;
  const upsertResponse = await fetcher(`${origin}/rest/v1/shelters?on_conflict=id`, {
    method: "POST",
    headers: {
      ...authorizationHeaders,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(prepared.rows),
  });
  if (!upsertResponse.ok) {
    throw new Error(`Shelter import upsert failed (HTTP ${upsertResponse.status})`);
  }

  const countResponse = await fetcher(`${origin}/rest/v1/shelters?select=id&limit=1`, {
    method: "HEAD",
    headers: {
      ...authorizationHeaders,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!countResponse.ok) {
    throw new Error(`Shelter import count verification failed (HTTP ${countResponse.status})`);
  }

  const verifiedCount = exactCount(countResponse);
  if (verifiedCount !== EXPECTED_SHELTER_COUNT) {
    throw new Error(
      `Shelter import expected ${EXPECTED_SHELTER_COUNT} rows but found ${verifiedCount}`,
    );
  }
  return Object.freeze({ importedCount: prepared.rows.length, verifiedCount });
}

type CliMode = "check" | "apply";

function parseCliMode(arguments_: readonly string[]): CliMode {
  if (arguments_.length === 1 && arguments_[0] === "--check") return "check";
  if (arguments_.length === 1 && arguments_[0] === "--apply") return "apply";
  throw new Error("Usage: bun scripts/import-shelters.ts --check|--apply");
}

async function runCli(arguments_: readonly string[]): Promise<void> {
  const mode = parseCliMode(arguments_);
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const collection = JSON.parse(
    await readFile(resolve(projectRoot, "data", "daegu_shelters.geojson"), "utf8"),
  ) as ShelterFeatureCollection;
  const prepared = prepareShelterImport(collection, new Date());

  if (mode === "check") {
    console.log(`Shelter import verified ${prepared.rows.length} official source rows.`);
    return;
  }

  const environment = z
    .object({
      SUPABASE_URL: z.string().url(),
      SUPABASE_SECRET_KEY: z.string().trim().min(1),
    })
    .strict()
    .parse({
      SUPABASE_URL: process.env["SUPABASE_URL"],
      SUPABASE_SECRET_KEY: process.env["SUPABASE_SECRET_KEY"],
    });
  const result = await applyShelterImport(prepared, {
    supabaseUrl: environment.SUPABASE_URL,
    secretKey: environment.SUPABASE_SECRET_KEY,
  });
  console.log(`Shelter import uploaded and verified ${result.verifiedCount} official source rows.`);
}

async function main(): Promise<void> {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected shelter import failure";
    console.error(`Shelter import failed: ${message}`);
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) void main();
