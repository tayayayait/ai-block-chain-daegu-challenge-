import "@tanstack/react-start/server-only";

import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";

const TimestampSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();
const SafeImagePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-attempt-[1-9][0-9]*\.(?:jpg|png|webp)$/u,
  );
const SafeErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u);
const DispositionSchema = z.enum(["APPLIED", "IDEMPOTENT", "LEASE_LOST"]);

const CleanupSummarySchema = z
  .object({
    access_tokens: z.number().int().nonnegative(),
    access_sessions: z.number().int().nonnegative(),
    route_cache: z.number().int().nonnegative(),
    medication_api_cache: z.number().int().nonnegative(),
    guardian_alerts: z.number().int().nonnegative(),
    attestation_jobs: z.number().int().nonnegative(),
    risk_recompute_queue: z.number().int().nonnegative(),
  })
  .strict();

const ImageCleanupClaimsSchema = z.array(
  z
    .object({
      cleanup_job_id: UuidSchema,
      image_path: SafeImagePathSchema,
      lease_token: UuidSchema,
      attempt_count: z.number().int().positive(),
    })
    .strict(),
);

export type RetentionCleanupSummary = z.infer<typeof CleanupSummarySchema>;
export type ImageCleanupClaim = Readonly<{
  cleanupJobId: string;
  imagePath: string;
  leaseToken: string;
  attemptCount: number;
}>;

export interface RetentionClient {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>,
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
  storage: {
    from(bucket: string): {
      remove(
        paths: readonly string[],
      ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
    };
  };
}

export interface RetentionRepository {
  cleanupDatabase(input: { now: string; limit: number }): Promise<RetentionCleanupSummary>;
  claimImageCleanupJobs(input: {
    now: string;
    limit: number;
  }): Promise<readonly ImageCleanupClaim[]>;
  deleteImageObject(imagePath: string): Promise<boolean>;
  finalizeImageCleanup(input: {
    cleanupJobId: string;
    leaseToken: string;
    deleted: boolean;
    errorCode: string | null;
    now: string;
  }): Promise<z.infer<typeof DispositionSchema>>;
}

export class RetentionRepositoryError extends Error {
  constructor(readonly code: "DATABASE_UNAVAILABLE" | "INVALID_RESPONSE") {
    super(code);
    this.name = "RetentionRepositoryError";
  }
}

function defaultClient(): RetentionClient {
  return createAdminSupabaseClient() as unknown as RetentionClient;
}

async function rpc(
  client: RetentionClient,
  functionName: string,
  parameters: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  let response: { readonly data: unknown; readonly error: unknown };
  try {
    response = await client.rpc(functionName, parameters);
  } catch {
    throw new RetentionRepositoryError("DATABASE_UNAVAILABLE");
  }
  if (response.error !== null) throw new RetentionRepositoryError("DATABASE_UNAVAILABLE");
  return response.data;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RetentionRepositoryError("INVALID_RESPONSE");
  return result.data;
}

export function createSupabaseRetentionRepository(
  client: RetentionClient = defaultClient(),
): RetentionRepository {
  return Object.freeze({
    async cleanupDatabase(input: { now: string; limit: number }) {
      return parse(
        CleanupSummarySchema,
        await rpc(client, "run_retention_cleanup", {
          p_now: TimestampSchema.parse(input.now),
          p_batch_limit: z.number().int().min(1).max(500).parse(input.limit),
        }),
      );
    },

    async claimImageCleanupJobs(input: { now: string; limit: number }) {
      const rows = parse(
        ImageCleanupClaimsSchema,
        await rpc(client, "claim_medication_image_cleanups", {
          p_now: TimestampSchema.parse(input.now),
          p_batch_limit: z.number().int().min(1).max(100).parse(input.limit),
        }),
      );
      return rows.map((row) =>
        Object.freeze({
          cleanupJobId: row.cleanup_job_id,
          imagePath: row.image_path,
          leaseToken: row.lease_token,
          attemptCount: row.attempt_count,
        }),
      );
    },

    async deleteImageObject(rawImagePath: string) {
      const imagePath = SafeImagePathSchema.parse(rawImagePath);
      try {
        const response = await client.storage.from("medication-images").remove([imagePath]);
        return response.error === null;
      } catch {
        return false;
      }
    },

    async finalizeImageCleanup(input: {
      cleanupJobId: string;
      leaseToken: string;
      deleted: boolean;
      errorCode: string | null;
      now: string;
    }) {
      const errorCode =
        input.errorCode === null ? null : SafeErrorCodeSchema.parse(input.errorCode);
      return parse(
        DispositionSchema,
        await rpc(client, "finalize_medication_image_cleanup", {
          p_cleanup_job_id: UuidSchema.parse(input.cleanupJobId),
          p_lease_token: UuidSchema.parse(input.leaseToken),
          p_deleted: input.deleted,
          p_error_code: errorCode,
          p_now: TimestampSchema.parse(input.now),
        }),
      );
    },
  });
}
