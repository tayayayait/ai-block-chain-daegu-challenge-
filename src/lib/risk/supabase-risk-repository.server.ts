import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ATTEST_STATES, HEAT_ADVISORIES, MED_RISK_TIERS, RISK_LEVELS } from "@/lib/domain-types";
import type {
  WeatherLocation,
  WeatherServiceResult,
} from "@/integrations/kma/weather-service.server";
import type {
  RiskCommitCommand,
  RiskCommitResult,
  RiskSnapshotWrite,
  RiskSubjectFacts,
} from "@/lib/risk/recompute-risk";
import type { RiskBatchRepository, RiskBatchSummary } from "@/lib/risk/recompute-risk.batch";
import type { RiskTransitionHistory } from "@/lib/risk/transitions";

const TimestampSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const RiskLevelSchema = z.enum(RISK_LEVELS);
const DangerLevelSchema = z.enum(["L3", "L4"]);

const SubjectCoreSchema = z
  .object({
    id: UuidSchema,
    birth_year: z.number().int(),
    lives_alone: z.boolean(),
    chronic_disease: z.boolean(),
    has_cooling: z.boolean(),
    medication_profile_registered_at: TimestampSchema.nullable(),
    longitude: z.number().finite().min(124).max(132),
    latitude: z.number().finite().min(32).max(40),
    kma_nx: z.number().int().positive(),
    kma_ny: z.number().int().positive(),
  })
  .strict();

const RiskSubjectCoreContextSchema = z
  .object({
    subject: SubjectCoreSchema,
    medications: z.array(
      z
        .object({
          heat_class: z.string().min(1).nullable(),
          risk_tier: z.enum(MED_RISK_TIERS),
        })
        .strict(),
    ),
    shelter_checkins: z.array(
      z
        .object({
          checked_in_at: TimestampSchema,
          attestation_state: z.enum(ATTEST_STATES),
        })
        .strict(),
    ),
  })
  .strict()
  .nullable();

const SnapshotHistorySchema = z
  .object({ level: RiskLevelSchema, computed_at: TimestampSchema })
  .strict();
const SafeSnapshotHistorySchema = SnapshotHistorySchema.extend({
  level: z.enum(["L0", "L1", "L2"]),
}).strict();
const ActiveEpisodeSchema = z.object({ id: UuidSchema, started_at: TimestampSchema }).strict();
const EpisodeTransitionSchema = z
  .object({
    transition_type: z.enum(["ENTER", "ESCALATE", "PERSIST_2H"]),
    to_level: DangerLevelSchema,
    occurred_at: TimestampSchema,
  })
  .strict();
const RiskHistoryRpcSchema = z
  .object({
    previous_snapshot: SnapshotHistorySchema.nullable(),
    last_safe_snapshot: SafeSnapshotHistorySchema.nullable(),
    active_episode: ActiveEpisodeSchema.nullable(),
    episode_transitions: z.array(EpisodeTransitionSchema),
  })
  .strict();

const BreakdownSchema = z
  .object({
    E: z.number().int().min(0).max(50),
    M: z.number().int().min(0).max(25),
    P: z.number().int().min(0).max(20),
    C: z.number().int().min(0).max(6),
  })
  .strict();
const SnapshotRowSchema = z
  .object({
    subject_id: UuidSchema,
    weather_snapshot_id: z.union([z.string().regex(/^\d+$/u), z.number().int().positive()]),
    hri: z.number().int().min(0).max(100),
    level: RiskLevelSchema,
    breakdown: BreakdownSchema,
    reasons: z.array(z.string().min(1)).min(1).max(3),
    input_hash: Sha256Schema,
    bucket_start: TimestampSchema,
    computed_at: TimestampSchema,
  })
  .strict();
const CommitRpcSchema = z
  .object({
    snapshot_inserted: z.boolean(),
    transition_inserted: z.boolean(),
    snapshot: SnapshotRowSchema,
  })
  .strict();

const SubjectIdRowsSchema = z.array(z.object({ id: UuidSchema }).strict());
const QueuedRiskRecomputeRowsSchema = z.array(
  z
    .object({
      shelter_checkin_id: UuidSchema,
      subject_id: UuidSchema,
      lease_until: TimestampSchema,
      attempt_count: z.number().int().positive(),
    })
    .strict(),
);
const QueueFinalizeDispositionSchema = z.enum(["APPLIED", "IDEMPOTENT", "LEASE_LOST"]);

type QueryResult = Readonly<{
  data: unknown;
  error: unknown | null;
}>;

export interface RiskWeatherResolver {
  resolve(location: WeatherLocation): Promise<WeatherServiceResult>;
}

export class RiskBatchRepositoryError extends Error {
  constructor(
    readonly code:
      | "RISK_REPOSITORY_QUERY_FAILED"
      | "RISK_REPOSITORY_INVALID_RESPONSE"
      | "RISK_REPOSITORY_WRITE_FAILED",
  ) {
    super(code);
    this.name = "RiskBatchRepositoryError";
  }
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new RiskBatchRepositoryError("RISK_REPOSITORY_INVALID_RESPONSE");
  }
  return parsed.data;
}

async function rpc(
  client: SupabaseClient,
  functionName: string,
  arguments_: Record<string, unknown>,
): Promise<unknown> {
  const result = (await client.rpc(functionName, arguments_)) as unknown as QueryResult;
  if (result.error) throw new RiskBatchRepositoryError("RISK_REPOSITORY_QUERY_FAILED");
  return result.data;
}

function coordinatePart(value: number): string {
  return value.toFixed(5);
}

export function buildApiHubCellId(longitude: number, latitude: number): string {
  const parsedLongitude = z.number().finite().min(124).max(132).parse(longitude);
  const parsedLatitude = z.number().finite().min(32).max(40).parse(latitude);
  return `coord-${coordinatePart(parsedLongitude)}-${coordinatePart(parsedLatitude)}`;
}

function weatherLocation(subject: z.infer<typeof SubjectCoreSchema>): WeatherLocation {
  return {
    apiHubCellId: buildApiHubCellId(subject.longitude, subject.latitude),
    longitude: subject.longitude,
    latitude: subject.latitude,
    kmaGrid: { nx: subject.kma_nx, ny: subject.kma_ny },
  };
}

function snapshotWrite(row: z.infer<typeof SnapshotRowSchema>): RiskSnapshotWrite {
  return {
    subjectId: row.subject_id,
    weatherSnapshotId: String(row.weather_snapshot_id),
    hri: row.hri,
    level: row.level,
    breakdown: row.breakdown,
    reasons: row.reasons,
    inputHash: row.input_hash,
    bucketStart: row.bucket_start,
    computedAt: row.computed_at,
  };
}

function rpcCommand(command: RiskCommitCommand): Record<string, unknown> {
  return {
    snapshot: {
      subject_id: command.snapshot.subjectId,
      weather_snapshot_id: command.snapshot.weatherSnapshotId,
      hri: command.snapshot.hri,
      level: command.snapshot.level,
      breakdown: command.snapshot.breakdown,
      reasons: command.snapshot.reasons,
      input_hash: command.snapshot.inputHash,
      bucket_start: command.snapshot.bucketStart,
      computed_at: command.snapshot.computedAt,
    },
    episode_mutation:
      command.episodeMutation.kind === "NONE"
        ? { kind: "NONE" }
        : command.episodeMutation.kind === "END"
          ? {
              kind: "END",
              episode_id: command.episodeMutation.episodeId,
              ended_at: command.episodeMutation.endedAt,
            }
          : {
              kind: "START",
              episode: {
                id: command.episodeMutation.episode.id,
                subject_id: command.episodeMutation.episode.subjectId,
                started_at: command.episodeMutation.episode.startedAt,
                entry_level: command.episodeMutation.episode.entryLevel,
              },
            },
    transition: command.transition
      ? {
          subject_id: command.transition.subjectId,
          episode_id: command.transition.episodeId,
          episode_started_at: command.transition.episodeStartedAt,
          from_level: command.transition.fromLevel,
          to_level: command.transition.toLevel,
          transition_type: command.transition.transitionType,
          idempotency_key: command.transition.idempotencyKey,
          occurred_at: command.transition.occurredAt,
        }
      : null,
  };
}

function batchRunRow(summary: RiskBatchSummary): Record<string, unknown> {
  return {
    id: summary.id,
    status: summary.status,
    started_at: summary.startedAt,
    finished_at: summary.finishedAt,
    total_subjects: summary.totalSubjects,
    succeeded_subjects: summary.succeededSubjects,
    failed_subjects: summary.failedSubjects,
    duplicate_snapshots: summary.duplicateSnapshots,
    transition_count: summary.transitionCount,
    failed_subject_ids: summary.failedSubjectIds,
  };
}

export function createSupabaseRiskBatchRepository(input: {
  readonly client: SupabaseClient;
  readonly weatherResolver: RiskWeatherResolver;
}): RiskBatchRepository {
  const weatherByLocation = new Map<string, Promise<WeatherServiceResult>>();

  const resolveWeather = (location: WeatherLocation): Promise<WeatherServiceResult> => {
    const key = `${location.apiHubCellId}:${location.kmaGrid.nx}:${location.kmaGrid.ny}`;
    const existing = weatherByLocation.get(key);
    if (existing) return existing;
    const pending = input.weatherResolver.resolve(location);
    weatherByLocation.set(key, pending);
    return pending;
  };

  return {
    async claimQueuedRiskRecomputes(request) {
      const rows = parseResponse(
        QueuedRiskRecomputeRowsSchema,
        await rpc(input.client, "claim_risk_recompute_queue", {
          p_now: TimestampSchema.parse(request.now),
          p_lease_until: TimestampSchema.parse(request.leaseUntil),
          p_limit: z.number().int().min(1).max(100).parse(request.limit),
        }),
      );
      return rows.map((row) => ({
        shelterCheckinId: row.shelter_checkin_id,
        subjectId: row.subject_id,
        leaseUntil: row.lease_until,
        attemptCount: row.attempt_count,
      }));
    },

    async finalizeQueuedRiskRecompute(request) {
      return parseResponse(
        QueueFinalizeDispositionSchema,
        await rpc(input.client, "finalize_risk_recompute_queue", {
          p_shelter_checkin_id: UuidSchema.parse(request.shelterCheckinId),
          p_expected_lease_until: TimestampSchema.parse(request.expectedLeaseUntil),
          p_completed_at: TimestampSchema.parse(request.completedAt),
          p_succeeded: request.succeeded,
          p_error_code: request.errorCode,
        }),
      );
    },

    async listRiskSubjectIds(): Promise<readonly string[]> {
      const result = (await input.client
        .from("subjects")
        .select("id")
        .order("id", { ascending: true })) as unknown as QueryResult;
      if (result.error) throw new RiskBatchRepositoryError("RISK_REPOSITORY_QUERY_FAILED");
      return parseResponse(SubjectIdRowsSchema, result.data).map(({ id }) => id);
    },

    async loadRiskFacts(subjectId, computedAt): Promise<RiskSubjectFacts | null> {
      const context = parseResponse(
        RiskSubjectCoreContextSchema,
        await rpc(input.client, "load_risk_subject_core", {
          p_subject_id: UuidSchema.parse(subjectId),
          p_computed_at: TimestampSchema.parse(computedAt),
        }),
      );
      if (!context) return null;

      const weather = await resolveWeather(weatherLocation(context.subject));
      return {
        subjectId: context.subject.id,
        birthYear: context.subject.birth_year,
        livesAlone: context.subject.lives_alone,
        chronicDisease: context.subject.chronic_disease,
        hasCooling: context.subject.has_cooling,
        medicationProfileRegisteredAt: context.subject.medication_profile_registered_at,
        medications: context.medications.map((medication) => ({
          heatClass: medication.heat_class,
          riskTier: medication.risk_tier,
        })),
        shelterCheckins: context.shelter_checkins.map((checkin) => ({
          checkedInAt: checkin.checked_in_at,
          attestationState: checkin.attestation_state,
        })),
        weather: {
          snapshotId: String(weather.weatherSnapshotId),
          feelsLikeC: weather.selection.reading.feelsLikeC,
          heatAdvisory: z.enum(HEAT_ADVISORIES).parse(weather.selection.reading.advisory),
          tropicalNightStreak: weather.selection.reading.tropicalNightStreak,
        },
      };
    },

    async loadRiskHistory(subjectId, computedAt): Promise<RiskTransitionHistory> {
      const history = parseResponse(
        RiskHistoryRpcSchema,
        await rpc(input.client, "load_risk_history", {
          p_subject_id: UuidSchema.parse(subjectId),
          p_computed_at: TimestampSchema.parse(computedAt),
        }),
      );
      return {
        previousSnapshot: history.previous_snapshot
          ? {
              level: history.previous_snapshot.level,
              computedAt: history.previous_snapshot.computed_at,
            }
          : null,
        lastSafeSnapshot: history.last_safe_snapshot
          ? {
              level: history.last_safe_snapshot.level,
              computedAt: history.last_safe_snapshot.computed_at,
            }
          : null,
        activeEpisode: history.active_episode
          ? { id: history.active_episode.id, startedAt: history.active_episode.started_at }
          : null,
        episodeTransitions: history.episode_transitions.map((transition) => ({
          transitionType: transition.transition_type,
          toLevel: transition.to_level,
          occurredAt: transition.occurred_at,
        })),
      };
    },

    async commitRiskComputation(command): Promise<RiskCommitResult> {
      const result = parseResponse(
        CommitRpcSchema,
        await rpc(input.client, "commit_risk_computation", {
          p_command: rpcCommand(command),
        }),
      );
      return {
        snapshot: snapshotWrite(result.snapshot),
        snapshotInserted: result.snapshot_inserted,
        transitionInserted: result.transition_inserted,
      };
    },

    async tryAcquireRiskBatchLock(request): Promise<boolean> {
      return parseResponse(
        z.boolean(),
        await rpc(input.client, "try_acquire_risk_batch_lock", {
          p_lock_key: request.lockKey,
          p_owner_id: request.ownerId,
          p_acquired_at: request.acquiredAt,
          p_lease_until: request.leaseUntil,
        }),
      );
    },

    async releaseRiskBatchLock(request): Promise<void> {
      parseResponse(
        z.boolean(),
        await rpc(input.client, "release_risk_batch_lock", {
          p_lock_key: request.lockKey,
          p_owner_id: request.ownerId,
        }),
      );
    },

    async recordRiskBatchRun(summary): Promise<void> {
      const result = (await input.client.from("risk_batch_runs").insert(batchRunRow(summary))) as
        QueryResult | undefined;
      if (!result || result.error) {
        throw new RiskBatchRepositoryError("RISK_REPOSITORY_WRITE_FAILED");
      }
    },
  };
}
