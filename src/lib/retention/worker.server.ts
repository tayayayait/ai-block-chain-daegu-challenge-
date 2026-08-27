import "@tanstack/react-start/server-only";

import { z } from "zod";

import type { RetentionCleanupSummary, RetentionRepository } from "./repository.server";

const LimitSchema = z.number().int().min(1);
const ImageConcurrencySchema = z.number().int().min(1).max(4);
const ImageDeleteTimeoutSchema = z.number().int().min(1).max(30_000);
const DEFAULT_IMAGE_CONCURRENCY = 4;
const DEFAULT_IMAGE_DELETE_TIMEOUT_MS = 5_000;

type ImageCleanupOutcome = "DELETED" | "RETRY_SCHEDULED" | "LEASE_LOST" | "FINALIZE_FAILED";

export type RetentionWorkerResult =
  | Readonly<{
      kind: "COMPLETED";
      database: RetentionCleanupSummary;
      imageClaimed: number;
      imageDeleted: number;
      imageRetryScheduled: number;
      imageLeaseLost: number;
      imageFinalizeFailed: number;
    }>
  | Readonly<{ kind: "TEMPORARY_FAILURE"; code: "RETENTION_DATABASE_UNAVAILABLE" }>;

function readNowIso(clock: () => Date): string | null {
  try {
    const value = clock();
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  } catch {
    return null;
  }
}

async function deleteImageWithin(
  repository: RetentionRepository,
  imagePath: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (deleted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(deleted);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);

    void Promise.resolve()
      .then(() => repository.deleteImageObject(imagePath))
      .then(
        (deleted) => finish(deleted === true),
        () => finish(false),
      );
  });
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value === undefined) return;
      results[index] = await task(value);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => worker()),
  );
  return results;
}

export async function runRetentionWorker(input: {
  readonly repository: RetentionRepository;
  readonly now?: () => Date;
  readonly databaseLimit?: number;
  readonly imageLimit?: number;
  readonly imageConcurrency?: number;
  readonly imageDeleteTimeoutMs?: number;
}): Promise<RetentionWorkerResult> {
  const clock = input.now ?? (() => new Date());
  const databaseLimit = LimitSchema.max(500).parse(input.databaseLimit ?? 500);
  const imageLimit = LimitSchema.max(100).parse(input.imageLimit ?? 50);
  const imageConcurrency = ImageConcurrencySchema.parse(
    input.imageConcurrency ?? DEFAULT_IMAGE_CONCURRENCY,
  );
  const imageDeleteTimeoutMs = ImageDeleteTimeoutSchema.parse(
    input.imageDeleteTimeoutMs ?? DEFAULT_IMAGE_DELETE_TIMEOUT_MS,
  );

  let database: RetentionCleanupSummary;
  let claims;
  try {
    const cleanupNow = readNowIso(clock);
    if (cleanupNow === null) throw new Error("INVALID_CLOCK");
    database = await input.repository.cleanupDatabase({ now: cleanupNow, limit: databaseLimit });

    const claimNow = readNowIso(clock);
    if (claimNow === null) throw new Error("INVALID_CLOCK");
    claims = await input.repository.claimImageCleanupJobs({ now: claimNow, limit: imageLimit });
  } catch {
    return Object.freeze({ kind: "TEMPORARY_FAILURE", code: "RETENTION_DATABASE_UNAVAILABLE" });
  }

  const outcomes = await mapWithConcurrency(claims, imageConcurrency, async (claim) => {
    const deleted = await deleteImageWithin(
      input.repository,
      claim.imagePath,
      imageDeleteTimeoutMs,
    );
    const finalizeNow = readNowIso(clock);
    if (finalizeNow === null) return "FINALIZE_FAILED" satisfies ImageCleanupOutcome;
    try {
      const disposition = await input.repository.finalizeImageCleanup({
        cleanupJobId: claim.cleanupJobId,
        leaseToken: claim.leaseToken,
        deleted,
        errorCode: deleted ? null : "STORAGE_DELETE_FAILED",
        now: finalizeNow,
      });
      if (disposition === "LEASE_LOST") return "LEASE_LOST";
      return deleted ? "DELETED" : "RETRY_SCHEDULED";
    } catch {
      return "FINALIZE_FAILED";
    }
  });

  const imageDeleted = outcomes.filter((outcome) => outcome === "DELETED").length;
  const imageRetryScheduled = outcomes.filter((outcome) => outcome === "RETRY_SCHEDULED").length;
  const imageLeaseLost = outcomes.filter((outcome) => outcome === "LEASE_LOST").length;
  const imageFinalizeFailed = outcomes.filter((outcome) => outcome === "FINALIZE_FAILED").length;

  return Object.freeze({
    kind: "COMPLETED",
    database,
    imageClaimed: claims.length,
    imageDeleted,
    imageRetryScheduled,
    imageLeaseLost,
    imageFinalizeFailed,
  });
}
