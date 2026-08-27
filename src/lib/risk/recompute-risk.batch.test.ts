import { describe, expect, it, vi } from "vitest";

import type { RiskCommitCommand, RiskSubjectFacts } from "./recompute-risk";
import {
  RiskCronUnauthorizedError,
  runRiskBatch,
  type RiskBatchRepository,
} from "./recompute-risk.batch";

const SECRET = "fixture-cron-secret-with-sufficient-entropy";
const RUN_ID = "40000000-0000-4000-8000-000000000001";
const CHECKIN_ID = "50000000-0000-4000-8000-000000000001";
const SUBJECT_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
] as const;

function facts(subjectId: string): RiskSubjectFacts {
  return {
    subjectId,
    birthYear: 1960,
    livesAlone: false,
    chronicDisease: false,
    hasCooling: true,
    medicationProfileRegisteredAt: "2026-01-01T00:00:00.000Z",
    medications: [],
    shelterCheckins: [],
    weather: {
      snapshotId: `weather-${subjectId}`,
      feelsLikeC: 30,
      heatAdvisory: "NONE",
      tropicalNightStreak: 0,
    },
  };
}

function batchRepository(overrides: Partial<RiskBatchRepository> = {}): RiskBatchRepository {
  return {
    claimQueuedRiskRecomputes: vi.fn(async () => []),
    finalizeQueuedRiskRecompute: vi.fn(async () => "APPLIED" as const),
    listRiskSubjectIds: vi.fn(async () => SUBJECT_IDS),
    tryAcquireRiskBatchLock: vi.fn(async () => true),
    releaseRiskBatchLock: vi.fn(async () => undefined),
    recordRiskBatchRun: vi.fn(async () => undefined),
    loadRiskFacts: vi.fn(async (subjectId) => facts(subjectId)),
    loadRiskHistory: vi.fn(async () => ({
      previousSnapshot: null,
      lastSafeSnapshot: null,
      activeEpisode: null,
      episodeTransitions: [],
    })),
    commitRiskComputation: vi.fn(async (command: RiskCommitCommand) => ({
      snapshot: command.snapshot,
      snapshotInserted: true,
      transitionInserted: false,
    })),
    ...overrides,
  };
}

describe("protected risk batch", () => {
  it("rejects an invalid bearer secret before accessing the repository", async () => {
    const repository = batchRepository();

    await expect(
      runRiskBatch({
        authorizationHeader: "Bearer wrong-secret",
        cronSecret: SECRET,
        computedAt: new Date("2026-08-23T04:00:00.000Z"),
        repository,
        runIdFactory: () => RUN_ID,
      }),
    ).rejects.toBeInstanceOf(RiskCronUnauthorizedError);

    expect(repository.tryAcquireRiskBatchLock).not.toHaveBeenCalled();
    expect(repository.listRiskSubjectIds).not.toHaveBeenCalled();
  });

  it("records a skipped summary and does no work when another batch owns the lock", async () => {
    const recordRiskBatchRun = vi.fn(async () => undefined);
    const repository = batchRepository({
      tryAcquireRiskBatchLock: vi.fn(async () => false),
      recordRiskBatchRun,
    });

    const summary = await runRiskBatch({
      authorizationHeader: `Bearer ${SECRET}`,
      cronSecret: SECRET,
      computedAt: new Date("2026-08-23T04:00:00.000Z"),
      repository,
      runIdFactory: () => RUN_ID,
      clock: () => new Date("2026-08-23T04:00:01.000Z"),
    });

    expect(summary).toMatchObject({
      id: RUN_ID,
      status: "SKIPPED_LOCKED",
      totalSubjects: 0,
      succeededSubjects: 0,
      failedSubjects: 0,
    });
    expect(recordRiskBatchRun).toHaveBeenCalledWith(summary);
    expect(repository.listRiskSubjectIds).not.toHaveBeenCalled();
    expect(repository.releaseRiskBatchLock).not.toHaveBeenCalled();
  });

  it("continues after one subject fails, records only safe failure identifiers, and releases the lock", async () => {
    const releaseRiskBatchLock = vi.fn(async () => undefined);
    const recordRiskBatchRun = vi.fn(async () => undefined);
    const repository = batchRepository({ releaseRiskBatchLock, recordRiskBatchRun });
    const recomputeSubject = vi.fn(async ({ subjectId }: { subjectId: string }) => {
      if (subjectId === SUBJECT_IDS[1]) throw new Error("UPSTREAM_SECRET_BODY");
      return {
        commit: {
          snapshotInserted: subjectId !== SUBJECT_IDS[2],
          transitionInserted: subjectId === SUBJECT_IDS[0],
        },
      };
    });

    const summary = await runRiskBatch({
      authorizationHeader: `Bearer ${SECRET}`,
      cronSecret: SECRET,
      computedAt: new Date("2026-08-23T04:00:00.000Z"),
      repository,
      runIdFactory: () => RUN_ID,
      clock: () => new Date("2026-08-23T04:00:02.000Z"),
      recomputeSubject,
    });

    expect(recomputeSubject).toHaveBeenCalledTimes(3);
    expect(summary).toEqual({
      id: RUN_ID,
      status: "PARTIAL",
      startedAt: "2026-08-23T04:00:00.000Z",
      finishedAt: "2026-08-23T04:00:02.000Z",
      totalSubjects: 3,
      succeededSubjects: 2,
      failedSubjects: 1,
      duplicateSnapshots: 1,
      transitionCount: 1,
      failedSubjectIds: [SUBJECT_IDS[1]],
    });
    expect(JSON.stringify(summary)).not.toContain("UPSTREAM_SECRET_BODY");
    expect(recordRiskBatchRun).toHaveBeenCalledWith(summary);
    expect(releaseRiskBatchLock).toHaveBeenCalledWith({
      lockKey: "risk-recompute",
      ownerId: RUN_ID,
    });
  });

  it("prioritizes a verified-check-in queue subject and finalizes it only after recomputation", async () => {
    const queuedSubjectId = "10000000-0000-4000-8000-000000000099";
    const leaseUntil = "2026-08-23T04:05:00.000Z";
    const finalizeQueuedRiskRecompute = vi.fn(async () => "APPLIED" as const);
    const repository = batchRepository({
      claimQueuedRiskRecomputes: vi.fn(async () => [
        {
          shelterCheckinId: CHECKIN_ID,
          subjectId: queuedSubjectId,
          leaseUntil,
          attemptCount: 1,
        },
      ]),
      listRiskSubjectIds: vi.fn(async () => SUBJECT_IDS),
      finalizeQueuedRiskRecompute,
    });
    const order: string[] = [];

    await runRiskBatch({
      authorizationHeader: `Bearer ${SECRET}`,
      cronSecret: SECRET,
      computedAt: new Date("2026-08-23T04:00:00.000Z"),
      repository,
      runIdFactory: () => RUN_ID,
      recomputeSubject: vi.fn(async ({ subjectId }: { subjectId: string }) => {
        order.push(subjectId);
        return { commit: { snapshotInserted: true, transitionInserted: false } };
      }),
    });

    expect(order[0]).toBe(queuedSubjectId);
    expect(finalizeQueuedRiskRecompute).toHaveBeenCalledWith({
      shelterCheckinId: CHECKIN_ID,
      expectedLeaseUntil: leaseUntil,
      completedAt: "2026-08-23T04:00:00.000Z",
      succeeded: true,
      errorCode: null,
    });
  });

  it("leaves a successfully recomputed queue item retryable when success finalization fails", async () => {
    const queuedSubjectId = "10000000-0000-4000-8000-000000000099";
    const leaseUntil = "2026-08-23T04:05:00.000Z";
    const finalizeQueuedRiskRecompute = vi.fn(async (request) => {
      if (request.succeeded) throw new Error("TRANSIENT_DATABASE_FAILURE");
      return "APPLIED" as const;
    });
    const repository = batchRepository({
      claimQueuedRiskRecomputes: vi.fn(async () => [
        {
          shelterCheckinId: CHECKIN_ID,
          subjectId: queuedSubjectId,
          leaseUntil,
          attemptCount: 1,
        },
      ]),
      listRiskSubjectIds: vi.fn(async () => []),
      finalizeQueuedRiskRecompute,
    });

    const summary = await runRiskBatch({
      authorizationHeader: `Bearer ${SECRET}`,
      cronSecret: SECRET,
      computedAt: new Date("2026-08-23T04:00:00.000Z"),
      repository,
      runIdFactory: () => RUN_ID,
      recomputeSubject: vi.fn(async () => ({
        commit: { snapshotInserted: true, transitionInserted: false },
      })),
    });

    expect(summary).toMatchObject({
      status: "PARTIAL",
      totalSubjects: 1,
      succeededSubjects: 0,
      failedSubjects: 1,
      failedSubjectIds: [queuedSubjectId],
    });
    expect(finalizeQueuedRiskRecompute).toHaveBeenCalledOnce();
    expect(finalizeQueuedRiskRecompute).not.toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: false }),
    );
  });
});
