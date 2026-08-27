import { describe, expect, it } from "vitest";

import { DEMO_SUBJECT_FIXTURES } from "../../../scripts/generate-supabase-seed";
import type {
  RiskCommitCommand,
  RiskCommitResult,
  RiskSnapshotWrite,
  RiskSubjectFacts,
} from "./recompute-risk";
import {
  runRiskBatch,
  type RiskBatchRepository,
  type RiskBatchSummary,
} from "./recompute-risk.batch";
import type { AlertTransitionWrite, RiskEpisode, RiskTransitionHistory } from "./transitions";

const COMPUTED_AT = new Date("2026-08-22T06:10:00.000Z");
// secret-scan: allow-next-line -- test-fixture
const CRON_SECRET = "five-subject-risk-batch-fixture-secret";

class MemoryRiskBatchRepository implements RiskBatchRepository {
  readonly facts = new Map<string, RiskSubjectFacts>();
  readonly snapshots: RiskSnapshotWrite[] = [];
  readonly transitions: AlertTransitionWrite[] = [];
  readonly runs: RiskBatchSummary[] = [];
  readonly episodes = new Map<string, RiskEpisode & { endedAt: string | null }>();
  private lockOwner: string | null = null;

  async claimQueuedRiskRecomputes(): Promise<readonly []> {
    return [];
  }

  async finalizeQueuedRiskRecompute(): Promise<"APPLIED"> {
    return "APPLIED";
  }

  async listRiskSubjectIds(): Promise<readonly string[]> {
    return [...this.facts.keys()];
  }

  async tryAcquireRiskBatchLock(request: { readonly ownerId: string }): Promise<boolean> {
    if (this.lockOwner) return false;
    this.lockOwner = request.ownerId;
    return true;
  }

  async releaseRiskBatchLock(request: { readonly ownerId: string }): Promise<void> {
    if (this.lockOwner === request.ownerId) this.lockOwner = null;
  }

  async recordRiskBatchRun(summary: RiskBatchSummary): Promise<void> {
    this.runs.push(summary);
  }

  async loadRiskFacts(subjectId: string): Promise<RiskSubjectFacts | null> {
    return this.facts.get(subjectId) ?? null;
  }

  async loadRiskHistory(subjectId: string): Promise<RiskTransitionHistory> {
    const subjectSnapshots = this.snapshots
      .filter((snapshot) => snapshot.subjectId === subjectId)
      .sort((left, right) => right.computedAt.localeCompare(left.computedAt));
    const previousSnapshot = subjectSnapshots[0] ?? null;
    const lastSafeSnapshot =
      subjectSnapshots.find(({ level }) => level === "L0" || level === "L1" || level === "L2") ??
      null;
    const activeEpisode = [...this.episodes.values()].find(
      (episode) => episode.subjectId === subjectId && episode.endedAt === null,
    );

    return {
      previousSnapshot: previousSnapshot
        ? { level: previousSnapshot.level, computedAt: previousSnapshot.computedAt }
        : null,
      lastSafeSnapshot: lastSafeSnapshot
        ? { level: lastSafeSnapshot.level, computedAt: lastSafeSnapshot.computedAt }
        : null,
      activeEpisode: activeEpisode
        ? { id: activeEpisode.id, startedAt: activeEpisode.startedAt }
        : null,
      episodeTransitions: activeEpisode
        ? this.transitions
            .filter(({ episodeId }) => episodeId === activeEpisode.id)
            .map(({ transitionType, toLevel, occurredAt }) => ({
              transitionType,
              toLevel,
              occurredAt,
            }))
        : [],
    };
  }

  async commitRiskComputation(command: RiskCommitCommand): Promise<RiskCommitResult> {
    const existing = this.snapshots.find(
      (snapshot) =>
        snapshot.subjectId === command.snapshot.subjectId &&
        snapshot.bucketStart === command.snapshot.bucketStart &&
        snapshot.inputHash === command.snapshot.inputHash,
    );
    if (!existing) this.snapshots.push(command.snapshot);

    if (command.episodeMutation.kind === "START") {
      const alreadyActive = [...this.episodes.values()].some(
        (episode) => episode.subjectId === command.snapshot.subjectId && episode.endedAt === null,
      );
      if (!alreadyActive) {
        this.episodes.set(command.episodeMutation.episode.id, {
          ...command.episodeMutation.episode,
          endedAt: null,
        });
      }
    } else if (command.episodeMutation.kind === "END") {
      const episode = this.episodes.get(command.episodeMutation.episodeId);
      if (episode) episode.endedAt = command.episodeMutation.endedAt;
    }

    const transitionInserted = Boolean(
      command.transition &&
      !this.transitions.some(
        ({ idempotencyKey }) => idempotencyKey === command.transition?.idempotencyKey,
      ),
    );
    if (command.transition && transitionInserted) this.transitions.push(command.transition);

    return {
      snapshot: existing ?? command.snapshot,
      snapshotInserted: !existing,
      transitionInserted,
    };
  }
}

function createRepository(): MemoryRiskBatchRepository {
  const repository = new MemoryRiskBatchRepository();
  for (const fixture of DEMO_SUBJECT_FIXTURES) {
    repository.facts.set(fixture.id, {
      subjectId: fixture.id,
      birthYear: fixture.birthYear,
      livesAlone: fixture.hriInput.livesAlone,
      chronicDisease: fixture.hriInput.chronicDisease,
      hasCooling: !fixture.hriInput.noCooling,
      medicationProfileRegisteredAt: fixture.medRegistered ? "2026-08-01T00:00:00.000Z" : null,
      medications: fixture.medications.map(({ heatClass, riskTier }) => ({
        heatClass,
        riskTier,
      })),
      shelterCheckins:
        fixture.checkinState === "NONE"
          ? []
          : [
              {
                checkedInAt: "2026-08-22T05:30:00.000Z",
                attestationState: fixture.checkinState,
              },
            ],
      weather: {
        snapshotId: `weather-${fixture.stableId}`,
        feelsLikeC: fixture.hriInput.feelsLikeC,
        heatAdvisory: fixture.hriInput.heatAdvisory,
        tropicalNightStreak: fixture.hriInput.tropicalNightStreak,
      },
    });
  }
  return repository;
}

describe("five-subject risk batch integration", () => {
  it("computes L0-L4, emits only two ENTER events, and makes an exact rerun idempotent", async () => {
    const repository = createRepository();
    const first = await runRiskBatch({
      authorizationHeader: `Bearer ${CRON_SECRET}`,
      cronSecret: CRON_SECRET,
      computedAt: COMPUTED_AT,
      repository,
      runIdFactory: () => "40000000-0000-4000-8000-000000000001",
      clock: () => new Date("2026-08-22T06:10:05.000Z"),
    });
    const second = await runRiskBatch({
      authorizationHeader: `Bearer ${CRON_SECRET}`,
      cronSecret: CRON_SECRET,
      computedAt: COMPUTED_AT,
      repository,
      runIdFactory: () => "40000000-0000-4000-8000-000000000002",
      clock: () => new Date("2026-08-22T06:10:10.000Z"),
    });

    expect(repository.snapshots).toHaveLength(5);
    expect(repository.snapshots.map(({ level }) => level).sort()).toEqual([
      "L0",
      "L1",
      "L2",
      "L3",
      "L4",
    ]);
    expect(repository.snapshots.map(({ hri }) => hri).sort((left, right) => left - right)).toEqual(
      DEMO_SUBJECT_FIXTURES.map(({ risk }) => risk.score).sort((left, right) => left - right),
    );
    expect(repository.transitions.map(({ transitionType }) => transitionType)).toEqual([
      "ENTER",
      "ENTER",
    ]);
    expect(first).toMatchObject({
      status: "COMPLETED",
      totalSubjects: 5,
      succeededSubjects: 5,
      duplicateSnapshots: 0,
      transitionCount: 2,
    });
    expect(second).toMatchObject({
      status: "COMPLETED",
      totalSubjects: 5,
      succeededSubjects: 5,
      duplicateSnapshots: 5,
      transitionCount: 0,
    });
  });
});
