import "@tanstack/react-start/server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { createSupabaseRetentionRepository } from "./repository.server";
import { runRetentionWorker, type RetentionWorkerResult } from "./worker.server";

export const RETENTION_CRON_SECRET_MIN_LENGTH = 16;

export function isRetentionCronAuthorized(
  authorizationHeader: string | null | undefined,
  cronSecret: string,
): boolean {
  const prefix = "Bearer ";
  const bearer = authorizationHeader?.startsWith(prefix) === true;
  const provided = bearer ? authorizationHeader.slice(prefix.length) : "";
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(cronSecret, "utf8").digest();
  return (
    cronSecret.length >= RETENTION_CRON_SECRET_MIN_LENGTH &&
    bearer &&
    provided.length > 0 &&
    timingSafeEqual(providedDigest, expectedDigest)
  );
}

export function runProductionRetentionWorker(now: Date): Promise<RetentionWorkerResult> {
  return runRetentionWorker({
    repository: createSupabaseRetentionRepository(),
    now: () => now,
  });
}
