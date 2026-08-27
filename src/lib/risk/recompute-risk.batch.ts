import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  recomputeRiskSubject,
  type RecomputeRiskResult,
  type RiskRecomputeRepository,
} from "@/lib/risk/recompute-risk";

export type RiskBatchStatus = "COMPLETED" | "PARTIAL" | "SKIPPED_LOCKED";

export interface RiskBatchSummary {
  readonly id: string;
  readonly status: RiskBatchStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly totalSubjects: number;
  readonly succeededSubjects: number;
  readonly failedSubjects: number;
  readonly duplicateSnapshots: number;
  readonly transitionCount: number;
  readonly failedSubjectIds: readonly string[];
}

export interface RiskBatchLockRequest {
  readonly lockKey: "risk-recompute";
  readonly ownerId: string;
  readonly acquiredAt: string;
  readonly leaseUntil: string;
}

export interface RiskRecomputeQueueClaim {
  readonly shelterCheckinId: string;
  readonly subjectId: string;
  readonly leaseUntil: string;
  readonly attemptCount: number;
}

export interface RiskRecomputeQueueFinalizeRequest {
  readonly shelterCheckinId: string;
  readonly expectedLeaseUntil: string;
  readonly completedAt: string;
  readonly succeeded: boolean;
  readonly errorCode: string | null;
}

export interface RiskBatchRepository extends RiskRecomputeRepository {
  listRiskSubjectIds(): Promise<readonly string[]>;
  claimQueuedRiskRecomputes(input: {
    readonly now: string;
    readonly leaseUntil: string;
    readonly limit: number;
  }): Promise<readonly RiskRecomputeQueueClaim[]>;
  finalizeQueuedRiskRecompute(
    input: RiskRecomputeQueueFinalizeRequest,
  ): Promise<"APPLIED" | "IDEMPOTENT" | "LEASE_LOST">;
  tryAcquireRiskBatchLock(request: RiskBatchLockRequest): Promise<boolean>;
  releaseRiskBatchLock(request: {
    readonly lockKey: "risk-recompute";
    readonly ownerId: string;
  }): Promise<void>;
  recordRiskBatchRun(summary: RiskBatchSummary): Promise<void>;
}

export class RiskCronUnauthorizedError extends Error {
  constructor() {
    super("Risk cron authorization failed");
    this.name = "RiskCronUnauthorizedError";
  }
}

type RecomputeWorker = (input: {
  readonly subjectId: string;
  readonly computedAt: Date;
  readonly repository: RiskBatchRepository;
}) => Promise<{
  readonly commit: Pick<RecomputeRiskResult["commit"], "snapshotInserted" | "transitionInserted">;
}>;

const LOCK_KEY = "risk-recompute" as const;
const LOCK_LEASE_MS = 25 * 60 * 1_000;
const QUEUE_LEASE_MS = 5 * 60 * 1_000;
const QUEUE_CLAIM_LIMIT = 100;
export const RISK_CRON_SECRET_MIN_LENGTH = 16;

function safeInstant(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new RangeError("Risk batch time must be valid");
  return value.toISOString();
}

export function isRiskCronAuthorized(
  authorizationHeader: string | null | undefined,
  cronSecret: string,
): boolean {
  if (
    !authorizationHeader?.startsWith("Bearer ") ||
    cronSecret.length < RISK_CRON_SECRET_MIN_LENGTH
  ) {
    return false;
  }
  const provided = Buffer.from(authorizationHeader.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(cronSecret, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function emptySummary(
  id: string,
  status: "SKIPPED_LOCKED",
  startedAt: string,
  finishedAt: string,
): RiskBatchSummary {
  return {
    id,
    status,
    startedAt,
    finishedAt,
    totalSubjects: 0,
    succeededSubjects: 0,
    failedSubjects: 0,
    duplicateSnapshots: 0,
    transitionCount: 0,
    failedSubjectIds: [],
  };
}

export async function runRiskBatch(input: {
  readonly authorizationHeader?: string | null;
  readonly cronSecret: string;
  readonly computedAt: Date;
  readonly repository: RiskBatchRepository;
  readonly runIdFactory?: () => string;
  readonly clock?: () => Date;
  readonly recomputeSubject?: RecomputeWorker;
}): Promise<RiskBatchSummary> {
  if (!isRiskCronAuthorized(input.authorizationHeader, input.cronSecret)) {
    throw new RiskCronUnauthorizedError();
  }

  const startedAt = safeInstant(input.computedAt);
  const runId = (input.runIdFactory ?? randomUUID)();
  const clock = input.clock ?? (() => new Date());
  const recomputeSubject = input.recomputeSubject ?? recomputeRiskSubject;
  const acquired = await input.repository.tryAcquireRiskBatchLock({
    lockKey: LOCK_KEY,
    ownerId: runId,
    acquiredAt: startedAt,
    leaseUntil: new Date(input.computedAt.getTime() + LOCK_LEASE_MS).toISOString(),
  });

  if (!acquired) {
    const summary = emptySummary(runId, "SKIPPED_LOCKED", startedAt, safeInstant(clock()));
    await input.repository.recordRiskBatchRun(summary);
    return summary;
  }

  try {
    const queueLeaseUntil = new Date(input.computedAt.getTime() + QUEUE_LEASE_MS).toISOString();
    const queued = await input.repository.claimQueuedRiskRecomputes({
      now: startedAt,
      leaseUntil: queueLeaseUntil,
      limit: QUEUE_CLAIM_LIMIT,
    });
    const queuedSubjectIds = queued.map(({ subjectId }) => subjectId);
    const subjectIds = [
      ...new Set([...queuedSubjectIds, ...(await input.repository.listRiskSubjectIds())]),
    ];
    const queuedBySubject = new Map<string, RiskRecomputeQueueClaim[]>();
    for (const item of queued) {
      const claims = queuedBySubject.get(item.subjectId) ?? [];
      claims.push(item);
      queuedBySubject.set(item.subjectId, claims);
    }
    let succeededSubjects = 0;
    let duplicateSnapshots = 0;
    let transitionCount = 0;
    const failedSubjectIds: string[] = [];

    for (const subjectId of subjectIds) {
      const subjectQueueClaims = queuedBySubject.get(subjectId) ?? [];
      let result: Awaited<ReturnType<RecomputeWorker>>;
      try {
        result = await recomputeSubject({
          subjectId,
          computedAt: input.computedAt,
          repository: input.repository,
        });
      } catch {
        // Provider and database error text is intentionally not persisted in the public summary.
        failedSubjectIds.push(subjectId);
        for (const item of subjectQueueClaims) {
          try {
            await input.repository.finalizeQueuedRiskRecompute({
              shelterCheckinId: item.shelterCheckinId,
              expectedLeaseUntil: item.leaseUntil,
              completedAt: input.computedAt.toISOString(),
              succeeded: false,
              errorCode: "RISK_RECOMPUTE_FAILED",
            });
          } catch {
            // An expired lease remains retryable and must not expose repository details.
          }
        }
        continue;
      }

      let queueFinalized = true;
      for (const item of subjectQueueClaims) {
        try {
          await input.repository.finalizeQueuedRiskRecompute({
            shelterCheckinId: item.shelterCheckinId,
            expectedLeaseUntil: item.leaseUntil,
            completedAt: input.computedAt.toISOString(),
            succeeded: true,
            errorCode: null,
          });
        } catch {
          // Do not overwrite a successful recomputation with a false failure. The lease expires
          // and the idempotent subject recomputation can safely retry on the next batch.
          queueFinalized = false;
        }
      }
      if (!queueFinalized) {
        failedSubjectIds.push(subjectId);
        continue;
      }

      succeededSubjects += 1;
      if (!result.commit.snapshotInserted) duplicateSnapshots += 1;
      if (result.commit.transitionInserted) transitionCount += 1;
    }

    const summary: RiskBatchSummary = {
      id: runId,
      status: failedSubjectIds.length > 0 ? "PARTIAL" : "COMPLETED",
      startedAt,
      finishedAt: safeInstant(clock()),
      totalSubjects: subjectIds.length,
      succeededSubjects,
      failedSubjects: failedSubjectIds.length,
      duplicateSnapshots,
      transitionCount,
      failedSubjectIds,
    };
    await input.repository.recordRiskBatchRun(summary);
    return summary;
  } finally {
    await input.repository.releaseRiskBatchLock({ lockKey: LOCK_KEY, ownerId: runId });
  }
}
