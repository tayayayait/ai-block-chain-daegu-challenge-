import "@tanstack/react-start/server-only";

import { z } from "zod";

import { EasClientError, type EasAttestationClient } from "./eas.server";
import {
  AttestationRepositoryError,
  type AttestationFinalizeOutcome,
  type AttestationRepository,
  type ClaimedAttestationJob,
} from "./repository.server";

const LEASE_MS = 4 * 60_000;
const RETRY_DELAYS_MS = Object.freeze([2_000, 8_000, 32_000] as const);

export type AttestationWorkerResult =
  | Readonly<{
      kind: "COMPLETED";
      claimed: number;
      verified: number;
      retryScheduled: number;
      failed: number;
      leaseLost: number;
      finalizeFailed: number;
    }>
  | Readonly<{ kind: "TEMPORARY_FAILURE"; code: "OUTBOX_UNAVAILABLE" }>;

interface WorkerCounters {
  claimed: number;
  verified: number;
  retryScheduled: number;
  failed: number;
  leaseLost: number;
  finalizeFailed: number;
}

const stableFailure = (
  error: unknown,
  durableSubmissionExists = false,
): Readonly<{ code: string; retryable: boolean }> => {
  if (error instanceof EasClientError) {
    if (error.code === "CONFIRMATION_UNCERTAIN" && durableSubmissionExists) {
      return Object.freeze({ code: error.code, retryable: true });
    }
    return Object.freeze({ code: error.code, retryable: error.retryable });
  }
  if (error instanceof AttestationRepositoryError) {
    switch (error.code) {
      case "QUERY_FAILED":
        return Object.freeze({ code: "TARGET_TEMPORARY", retryable: true });
      case "ALREADY_ATTESTED":
        return Object.freeze({ code: "ALREADY_ATTESTED", retryable: false });
      case "INVALID_CONFIG":
        return Object.freeze({ code: "INVALID_CONFIG", retryable: false });
      case "LEASE_LOST":
        return Object.freeze({ code: "LEASE_LOST", retryable: false });
      case "INVALID_REQUEST":
      case "INVALID_RESPONSE":
      case "INVALID_TARGET":
        return Object.freeze({ code: "INVALID_TARGET", retryable: false });
    }
  }
  return Object.freeze({ code: "ATTESTATION_TEMPORARY", retryable: true });
};

const failureOutcome = (
  job: ClaimedAttestationJob,
  error: unknown,
  now: Date,
  durableSubmissionExists = false,
): AttestationFinalizeOutcome => {
  const failure = stableFailure(error, durableSubmissionExists);
  if (!failure.retryable) return { kind: "FAILED", errorCode: failure.code };

  const delay = RETRY_DELAYS_MS[job.attemptCount - 1];
  if (delay === undefined) return { kind: "FAILED", errorCode: "RETRY_EXHAUSTED" };
  return {
    kind: "RETRY_WAIT",
    errorCode: failure.code,
    nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
  };
};

const countApplied = (
  counters: WorkerCounters,
  outcome: AttestationFinalizeOutcome,
  disposition: "APPLIED" | "IDEMPOTENT" | "LEASE_LOST",
): void => {
  if (disposition === "LEASE_LOST") {
    counters.leaseLost += 1;
    return;
  }
  switch (outcome.kind) {
    case "VERIFIED":
      counters.verified += 1;
      return;
    case "RETRY_WAIT":
      counters.retryScheduled += 1;
      return;
    case "FAILED":
      counters.failed += 1;
      return;
  }
};

const finalizeSafely = async (input: {
  readonly repository: AttestationRepository;
  readonly job: ClaimedAttestationJob;
  readonly outcome: AttestationFinalizeOutcome;
  readonly counters: WorkerCounters;
}): Promise<void> => {
  try {
    const result = await input.repository.finalize({
      jobId: input.job.jobId,
      claimToken: input.job.claimToken,
      expectedLeaseUntil: input.job.leaseUntil,
      outcome: input.outcome,
    });
    countApplied(input.counters, input.outcome, result.disposition);
  } catch {
    input.counters.finalizeFailed += 1;
  }
};

const processJob = async (input: {
  readonly repository: AttestationRepository;
  readonly eas: EasAttestationClient;
  readonly job: ClaimedAttestationJob;
  readonly now: Date;
  readonly counters: WorkerCounters;
}): Promise<void> => {
  let outcome: AttestationFinalizeOutcome;
  let durableSubmissionExists = input.job.submission !== null;
  try {
    const target = await input.repository.loadTarget(input.job);
    let submission = input.job.submission;
    if (submission === null) {
      const beginDisposition = await input.repository.beginSubmission({
        jobId: input.job.jobId,
        claimToken: input.job.claimToken,
        expectedLeaseUntil: input.job.leaseUntil,
        startedAt: input.now.toISOString(),
      });
      if (beginDisposition === "LEASE_LOST") {
        input.counters.leaseLost += 1;
        return;
      }

      submission = await input.eas.submit({
        schemaKind: target.schemaKind,
        value: target.value,
        idempotencyKey: input.job.idempotencyKey,
        existingAttestationUid: target.existingAttestationUid,
      });
      const recordDisposition = await input.repository.recordSubmission({
        jobId: input.job.jobId,
        claimToken: input.job.claimToken,
        submission,
        submittedAt: input.now.toISOString(),
      });
      if (recordDisposition === "LEASE_LOST") {
        input.counters.leaseLost += 1;
        return;
      }
      durableSubmissionExists = true;
    }

    const result = await input.eas.confirm(submission);
    outcome = { kind: "VERIFIED", ...result };
  } catch (error) {
    if (error instanceof AttestationRepositoryError && error.code === "LEASE_LOST") {
      input.counters.leaseLost += 1;
      return;
    }
    outcome = failureOutcome(input.job, error, input.now, durableSubmissionExists);
  }

  await finalizeSafely({
    repository: input.repository,
    job: input.job,
    outcome,
    counters: input.counters,
  });
};

export async function runAttestationWorker(input: {
  readonly repository: AttestationRepository;
  readonly eas: EasAttestationClient;
  readonly now?: () => Date;
  readonly limit?: number;
}): Promise<AttestationWorkerResult> {
  const now = input.now?.() ?? new Date();
  const limit = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(input.limit ?? 20);
  const leaseUntil = new Date(now.getTime() + LEASE_MS);

  let jobs: readonly ClaimedAttestationJob[];
  try {
    jobs = await input.repository.claim({
      now: now.toISOString(),
      leaseUntil: leaseUntil.toISOString(),
      limit,
    });
  } catch {
    return Object.freeze({ kind: "TEMPORARY_FAILURE", code: "OUTBOX_UNAVAILABLE" });
  }

  const counters: WorkerCounters = {
    claimed: jobs.length,
    verified: 0,
    retryScheduled: 0,
    failed: 0,
    leaseLost: 0,
    finalizeFailed: 0,
  };
  for (const job of jobs) {
    await processJob({
      repository: input.repository,
      eas: input.eas,
      job,
      now,
      counters,
    });
  }
  return Object.freeze({ kind: "COMPLETED", ...counters });
}
