import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { WeatherServiceResult } from "@/integrations/kma/weather-service.server";
import type { RiskCommitCommand } from "./recompute-risk";
import {
  buildApiHubCellId,
  createSupabaseRiskBatchRepository,
  RiskBatchRepositoryError,
  type RiskWeatherResolver,
} from "./supabase-risk-repository.server";

const SUBJECT_A = "10000000-0000-4000-8000-000000000001";
const SUBJECT_B = "10000000-0000-4000-8000-000000000002";
const COMPUTED_AT = "2026-08-23T12:00:00.000Z";

function coreContext(subjectId: string) {
  return {
    subject: {
      id: subjectId,
      birth_year: 1940,
      lives_alone: true,
      chronic_disease: true,
      has_cooling: false,
      medication_profile_registered_at: "2026-08-01T00:00:00.000Z",
      longitude: 128.60123,
      latitude: 35.87111,
      kma_nx: 89,
      kma_ny: 90,
    },
    medications: [
      { heat_class: "이뇨제", risk_tier: "HIGH" },
      { heat_class: "이뇨제", risk_tier: "HIGH" },
    ],
    shelter_checkins: [
      { checked_in_at: "2026-08-23T11:00:00.000Z", attestation_state: "VERIFIED" },
    ],
  };
}

function weatherResolver(): RiskWeatherResolver {
  return {
    resolve: vi.fn(async (): Promise<WeatherServiceResult> => ({
      weatherSnapshotId: 701,
      selection: {
        mode: "PRIMARY",
        state: "success",
        reading: {
          source: "KMA_APIHUB_500M",
          observedAt: "2026-08-23T11:55:00+00:00",
          airTemperatureC: 36,
          relativeHumidityPct: 70,
          feelsLikeC: 39,
          advisory: "WARNING",
          tropicalNightStreak: 3,
          tropicalNightPartial: false,
        },
        isStale: false,
        errorCode: null,
        expiresAt: "2026-08-23T12:25:00+00:00",
        shouldPersistWeatherSnapshot: true,
      },
    })),
  };
}

function clientWithRpc(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

describe("Supabase risk repository", () => {
  it("loads private subject facts and memoizes weather resolution for one coordinate/grid", async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name !== "load_risk_subject_core") throw new Error("unexpected rpc");
      return { data: coreContext(String(args["p_subject_id"])), error: null };
    });
    const resolver = weatherResolver();
    const repository = createSupabaseRiskBatchRepository({
      client: clientWithRpc(rpc),
      weatherResolver: resolver,
    });

    const first = await repository.loadRiskFacts(SUBJECT_A, COMPUTED_AT);
    const second = await repository.loadRiskFacts(SUBJECT_B, COMPUTED_AT);

    expect(first).toMatchObject({
      subjectId: SUBJECT_A,
      birthYear: 1940,
      medicationProfileRegisteredAt: "2026-08-01T00:00:00.000Z",
      medications: [
        { heatClass: "이뇨제", riskTier: "HIGH" },
        { heatClass: "이뇨제", riskTier: "HIGH" },
      ],
      weather: {
        snapshotId: "701",
        feelsLikeC: 39,
        heatAdvisory: "WARNING",
        tropicalNightStreak: 3,
      },
    });
    expect(second?.subjectId).toBe(SUBJECT_B);
    expect(resolver.resolve).toHaveBeenCalledOnce();
    expect(resolver.resolve).toHaveBeenCalledWith({
      apiHubCellId: buildApiHubCellId(128.60123, 35.87111),
      longitude: 128.60123,
      latitude: 35.87111,
      kmaGrid: { nx: 89, ny: 90 },
    });
  });

  it("loads the latest snapshot, last safe snapshot, active episode, and its transitions", async () => {
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: {
        previous_snapshot: { level: "L3", computed_at: "2026-08-23T11:30:00.000Z" },
        last_safe_snapshot: { level: "L2", computed_at: "2026-08-23T09:30:00.000Z" },
        active_episode: {
          id: "30000000-0000-4000-8000-000000000001",
          started_at: "2026-08-23T10:00:00.000Z",
        },
        episode_transitions: [
          {
            transition_type: "ENTER",
            to_level: "L3",
            occurred_at: "2026-08-23T10:00:00.000Z",
          },
        ],
      },
      error: null,
    }));
    const repository = createSupabaseRiskBatchRepository({
      client: clientWithRpc(rpc),
      weatherResolver: weatherResolver(),
    });

    await expect(repository.loadRiskHistory(SUBJECT_A, COMPUTED_AT)).resolves.toEqual({
      previousSnapshot: { level: "L3", computedAt: "2026-08-23T11:30:00.000Z" },
      lastSafeSnapshot: { level: "L2", computedAt: "2026-08-23T09:30:00.000Z" },
      activeEpisode: {
        id: "30000000-0000-4000-8000-000000000001",
        startedAt: "2026-08-23T10:00:00.000Z",
      },
      episodeTransitions: [
        {
          transitionType: "ENTER",
          toLevel: "L3",
          occurredAt: "2026-08-23T10:00:00.000Z",
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith("load_risk_history", {
      p_subject_id: SUBJECT_A,
      p_computed_at: COMPUTED_AT,
    });
  });

  it("commits snapshot, episode, and transition without an ALERT_SENT claim", async () => {
    const command: RiskCommitCommand = {
      snapshot: {
        subjectId: SUBJECT_A,
        weatherSnapshotId: "701",
        hri: 72,
        level: "L3",
        breakdown: { E: 42, M: 12, P: 18, C: 0 },
        reasons: ["환경 점수 (+42)"],
        inputHash: "a".repeat(64),
        bucketStart: "2026-08-23T12:00:00.000Z",
        computedAt: COMPUTED_AT,
      },
      episodeMutation: {
        kind: "START",
        episode: {
          id: "30000000-0000-4000-8000-000000000001",
          subjectId: SUBJECT_A,
          startedAt: COMPUTED_AT,
          entryLevel: "L3",
        },
      },
      transition: {
        subjectId: SUBJECT_A,
        episodeId: "30000000-0000-4000-8000-000000000001",
        episodeStartedAt: COMPUTED_AT,
        fromLevel: "L2",
        toLevel: "L3",
        transitionType: "ENTER",
        idempotencyKey: `${SUBJECT_A}:30000000-0000-4000-8000-000000000001:L3:ENTER`,
        occurredAt: COMPUTED_AT,
      },
    };
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: {
        snapshot_inserted: true,
        transition_inserted: true,
        snapshot: {
          subject_id: SUBJECT_A,
          weather_snapshot_id: "701",
          hri: 72,
          level: "L3",
          breakdown: { E: 42, M: 12, P: 18, C: 0 },
          reasons: ["환경 점수 (+42)"],
          input_hash: "a".repeat(64),
          bucket_start: "2026-08-23T12:00:00.000Z",
          computed_at: COMPUTED_AT,
        },
      },
      error: null,
    }));
    const repository = createSupabaseRiskBatchRepository({
      client: clientWithRpc(rpc),
      weatherResolver: weatherResolver(),
    });

    const result = await repository.commitRiskComputation(command);

    expect(result).toMatchObject({ snapshotInserted: true, transitionInserted: true });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]?.[0]).toBe("commit_risk_computation");
    expect(rpc.mock.calls[0]?.[1]).toEqual({
      p_command: expect.objectContaining({
        snapshot: expect.objectContaining({ input_hash: "a".repeat(64) }),
        transition: expect.objectContaining({ transition_type: "ENTER" }),
      }),
    });
    expect((rpc.mock.calls[0]?.[1] as { p_command: unknown }).p_command).not.toHaveProperty(
      "care_event",
    );
  });

  it("claims and finalizes verified-check-in recompute queue leases through bounded RPCs", async () => {
    const checkinId = "50000000-0000-4000-8000-000000000001";
    const leaseUntil = "2026-08-23T12:05:00.000Z";
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_risk_recompute_queue") {
        return {
          data: [
            {
              shelter_checkin_id: checkinId,
              subject_id: SUBJECT_A,
              lease_until: leaseUntil,
              attempt_count: 2,
            },
          ],
          error: null,
        };
      }
      if (name === "finalize_risk_recompute_queue") {
        return { data: "APPLIED", error: null };
      }
      throw new Error("unexpected rpc");
    });
    const repository = createSupabaseRiskBatchRepository({
      client: clientWithRpc(rpc),
      weatherResolver: weatherResolver(),
    });

    await expect(
      repository.claimQueuedRiskRecomputes({
        now: COMPUTED_AT,
        leaseUntil,
        limit: 20,
      }),
    ).resolves.toEqual([
      {
        shelterCheckinId: checkinId,
        subjectId: SUBJECT_A,
        leaseUntil,
        attemptCount: 2,
      },
    ]);
    await expect(
      repository.finalizeQueuedRiskRecompute({
        shelterCheckinId: checkinId,
        expectedLeaseUntil: leaseUntil,
        completedAt: COMPUTED_AT,
        succeeded: true,
        errorCode: null,
      }),
    ).resolves.toBe("APPLIED");

    expect(rpc).toHaveBeenNthCalledWith(1, "claim_risk_recompute_queue", {
      p_now: COMPUTED_AT,
      p_lease_until: leaseUntil,
      p_limit: 20,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "finalize_risk_recompute_queue", {
      p_shelter_checkin_id: checkinId,
      p_expected_lease_until: leaseUntil,
      p_completed_at: COMPUTED_AT,
      p_succeeded: true,
      p_error_code: null,
    });
  });

  it("lists subjects, owns the database lease, and records a server-only run summary", async () => {
    const order = vi.fn(async () => ({
      data: [{ id: SUBJECT_A }, { id: SUBJECT_B }],
      error: null,
    }));
    const select = vi.fn(() => ({ order }));
    const insert = vi.fn(async () => ({ data: null, error: null }));
    const from = vi.fn((table: string) => {
      if (table === "subjects") return { select };
      if (table === "risk_batch_runs") return { insert };
      throw new Error("unexpected table");
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === "try_acquire_risk_batch_lock" || name === "release_risk_batch_lock") {
        return { data: true, error: null };
      }
      throw new Error("unexpected rpc");
    });
    const repository = createSupabaseRiskBatchRepository({
      client: { from, rpc } as unknown as SupabaseClient,
      weatherResolver: weatherResolver(),
    });
    const lock = {
      lockKey: "risk-recompute" as const,
      ownerId: "40000000-0000-4000-8000-000000000001",
      acquiredAt: COMPUTED_AT,
      leaseUntil: "2026-08-23T12:25:00.000Z",
    };

    await expect(repository.listRiskSubjectIds()).resolves.toEqual([SUBJECT_A, SUBJECT_B]);
    await expect(repository.tryAcquireRiskBatchLock(lock)).resolves.toBe(true);
    await expect(
      repository.releaseRiskBatchLock({ lockKey: lock.lockKey, ownerId: lock.ownerId }),
    ).resolves.toBeUndefined();
    await repository.recordRiskBatchRun({
      id: lock.ownerId,
      status: "COMPLETED",
      startedAt: COMPUTED_AT,
      finishedAt: "2026-08-23T12:00:05.000Z",
      totalSubjects: 2,
      succeededSubjects: 2,
      failedSubjects: 0,
      duplicateSnapshots: 1,
      transitionCount: 1,
      failedSubjectIds: [],
    });

    expect(from).toHaveBeenNthCalledWith(1, "subjects");
    expect(rpc).toHaveBeenCalledWith("try_acquire_risk_batch_lock", {
      p_lock_key: lock.lockKey,
      p_owner_id: lock.ownerId,
      p_acquired_at: lock.acquiredAt,
      p_lease_until: lock.leaseUntil,
    });
    expect(rpc).toHaveBeenCalledWith("release_risk_batch_lock", {
      p_lock_key: lock.lockKey,
      p_owner_id: lock.ownerId,
    });
    expect(insert).toHaveBeenCalledWith({
      id: lock.ownerId,
      status: "COMPLETED",
      started_at: COMPUTED_AT,
      finished_at: "2026-08-23T12:00:05.000Z",
      total_subjects: 2,
      succeeded_subjects: 2,
      failed_subjects: 0,
      duplicate_snapshots: 1,
      transition_count: 1,
      failed_subject_ids: [],
    });
  });

  it("maps database failures to a stable code without exposing provider text", async () => {
    const secret = "DATABASE_CONNECTION_SECRET";
    const rpc = vi.fn(async () => ({ data: null, error: { message: secret } }));
    const repository = createSupabaseRiskBatchRepository({
      client: clientWithRpc(rpc),
      weatherResolver: weatherResolver(),
    });

    const error = await repository
      .loadRiskHistory(SUBJECT_A, COMPUTED_AT)
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(RiskBatchRepositoryError);
    expect(error.message).toBe("RISK_REPOSITORY_QUERY_FAILED");
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
