import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";

export const MFDS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type MedicationApiKind = "PILL_IDENTIFICATION" | "E_DRUG" | "DUR";

export interface MedicationApiCacheLookup {
  apiKind: MedicationApiKind;
  requestHash: string;
  now: Date;
}

export interface MedicationApiCacheEntry {
  apiKind: MedicationApiKind;
  requestHash: string;
  response: unknown;
  fetchedAt: Date;
  expiresAt: Date;
}

export interface MedicationApiCacheRepository {
  findFresh(lookup: MedicationApiCacheLookup): Promise<unknown | null>;
  save(entry: MedicationApiCacheEntry): Promise<void>;
}

const MedicationApiKindSchema = z.enum(["PILL_IDENTIFICATION", "E_DRUG", "DUR"]);
const RequestHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const JsonContainerSchema = z.union([z.record(z.unknown()), z.array(z.unknown())]);
const CacheRowSchema = z
  .object({
    api_kind: MedicationApiKindSchema,
    request_hash: RequestHashSchema,
    response: JsonContainerSchema,
    fetched_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();

type CacheQueryResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string }> | null;
}>;

export class MfdsCacheRepositoryError extends Error {
  constructor() {
    super("MFDS_CACHE_REPOSITORY_FAILED");
    this.name = "MfdsCacheRepositoryError";
  }
}

function cacheFailure(): never {
  throw new MfdsCacheRepositoryError();
}

/** Trusted-server repository; callers must never return its service-role client. */
export function createSupabaseMedicationApiCacheRepository(
  client: SupabaseClient,
): MedicationApiCacheRepository {
  return {
    async findFresh(lookup) {
      const apiKind = MedicationApiKindSchema.parse(lookup.apiKind);
      const requestHash = RequestHashSchema.parse(lookup.requestHash);
      const now = z.date().parse(lookup.now);
      let result: CacheQueryResult;
      try {
        result = (await client
          .from("medication_api_cache")
          .select("api_kind,request_hash,response,fetched_at,expires_at")
          .eq("api_kind", apiKind)
          .eq("request_hash", requestHash)
          .gt("expires_at", now.toISOString())
          .maybeSingle()) as CacheQueryResult;
      } catch {
        return cacheFailure();
      }
      if (result.error) return cacheFailure();
      if (result.data === null) return null;
      const row = CacheRowSchema.safeParse(result.data);
      if (!row.success || Date.parse(row.data.expires_at) <= now.getTime()) {
        return cacheFailure();
      }
      return row.data.response;
    },

    async save(entry) {
      const parsed = z
        .object({
          apiKind: MedicationApiKindSchema,
          requestHash: RequestHashSchema,
          response: JsonContainerSchema,
          fetchedAt: z.date(),
          expiresAt: z.date(),
        })
        .strict()
        .refine((value) => value.expiresAt.getTime() > value.fetchedAt.getTime())
        .parse(entry);
      try {
        const result = await client.from("medication_api_cache").upsert(
          {
            api_kind: parsed.apiKind,
            request_hash: parsed.requestHash,
            response: parsed.response,
            fetched_at: parsed.fetchedAt.toISOString(),
            expires_at: parsed.expiresAt.toISOString(),
          },
          { onConflict: "api_kind,request_hash" },
        );
        if (result.error) return cacheFailure();
      } catch {
        return cacheFailure();
      }
    },
  };
}

export function createDefaultMedicationApiCacheRepository(): MedicationApiCacheRepository {
  return createSupabaseMedicationApiCacheRepository(createAdminSupabaseClient());
}

function canonicalParams(params: Readonly<Record<string, string>>): string {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key.length}:${key}=${value.length}:${value}`)
    .join("&");
}

export function createMedicationRequestHash(
  apiKind: MedicationApiKind,
  endpointPath: string,
  params: Readonly<Record<string, string>>,
): string {
  return createHash("sha256")
    .update(`${apiKind}\n${endpointPath}\n${canonicalParams(params)}`, "utf8")
    .digest("hex");
}
