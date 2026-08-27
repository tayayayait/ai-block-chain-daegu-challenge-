import { createHash } from "node:crypto";

import type { AttestState, HeatAdvisory, MedRiskTier, RiskLevel } from "@/lib/domain-types";
import { computeHri, type HriInput, type HriResult } from "@/lib/risk/hri";
import { buildHriReasons } from "@/lib/risk/reasons";
import {
  decideRiskTransition,
  type AlertTransitionWrite,
  type RiskEpisodeMutation,
  type RiskTransitionHistory,
} from "@/lib/risk/transitions";

export interface MedicationRiskFact {
  readonly heatClass: string | null;
  readonly riskTier: MedRiskTier;
}

export interface ShelterCheckinRiskFact {
  readonly checkedInAt: string;
  readonly attestationState: AttestState;
}

export interface WeatherRiskFact {
  /** Bigint database identifiers cross the boundary as decimal strings. */
  readonly snapshotId: string;
  readonly feelsLikeC: number;
  readonly heatAdvisory: HeatAdvisory;
  readonly tropicalNightStreak: number;
}

export interface RiskSubjectFacts {
  readonly subjectId: string;
  readonly birthYear: number;
  readonly livesAlone: boolean;
  readonly chronicDisease: boolean;
  readonly hasCooling: boolean;
  readonly medicationProfileRegisteredAt: string | null;
  readonly medications: readonly MedicationRiskFact[];
  readonly shelterCheckins: readonly ShelterCheckinRiskFact[];
  readonly weather: WeatherRiskFact;
}

export interface RiskSnapshotWrite {
  readonly subjectId: string;
  readonly weatherSnapshotId: string;
  readonly hri: number;
  readonly level: RiskLevel;
  readonly breakdown: HriResult["breakdown"];
  readonly reasons: readonly string[];
  readonly inputHash: string;
  readonly bucketStart: string;
  readonly computedAt: string;
}

export interface RiskCommitCommand {
  /** Implementations must persist this command atomically and honor DB unique keys. */
  readonly snapshot: RiskSnapshotWrite;
  readonly episodeMutation: RiskEpisodeMutation;
  readonly transition: AlertTransitionWrite | null;
}

export interface RiskCommitResult {
  readonly snapshot: RiskSnapshotWrite;
  readonly snapshotInserted: boolean;
  readonly transitionInserted: boolean;
}

export interface RiskRecomputeRepository {
  loadRiskFacts(subjectId: string, computedAt: string): Promise<RiskSubjectFacts | null>;
  loadRiskHistory(subjectId: string, computedAt: string): Promise<RiskTransitionHistory>;
  commitRiskComputation(command: RiskCommitCommand): Promise<RiskCommitResult>;
}

export interface RecomputeRiskResult {
  readonly hri: HriResult;
  readonly snapshot: RiskSnapshotWrite;
  readonly transition: AlertTransitionWrite | null;
  readonly commit: RiskCommitResult;
}

export class RiskSubjectNotFoundError extends Error {
  constructor() {
    super("Risk subject is unavailable");
    this.name = "RiskSubjectNotFoundError";
  }
}

const THIRTY_MINUTES_MS = 30 * 60 * 1_000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

function validInstant(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError("Risk calculation time must be valid");
  return parsed;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicUuid(seed: string): string {
  const hexadecimal = sha256(seed).slice(0, 32).split("");
  hexadecimal[12] = "5";
  const variant = Number.parseInt(hexadecimal[16] ?? "0", 16);
  hexadecimal[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hexadecimal.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function riskBucketStart(computedAt: Date): string {
  const instant = validInstant(computedAt);
  return new Date(Math.floor(instant / THIRTY_MINUTES_MS) * THIRTY_MINUTES_MS).toISOString();
}

function medicationCounts(medications: readonly MedicationRiskFact[]): {
  readonly high: number;
  readonly mid: number;
} {
  const tierByClass = new Map<string, "HIGH" | "MID">();
  for (const medication of medications) {
    const heatClass = medication.heatClass?.trim();
    if (!heatClass || medication.riskTier === "NONE") continue;
    const existing = tierByClass.get(heatClass);
    if (existing === "HIGH") continue;
    tierByClass.set(heatClass, medication.riskTier);
  }

  let high = 0;
  let mid = 0;
  for (const tier of tierByClass.values()) {
    if (tier === "HIGH") high += 1;
    else mid += 1;
  }
  return { high, mid };
}

function hasVerifiedCheckinWithin24Hours(
  checkins: readonly ShelterCheckinRiskFact[],
  computedAt: Date,
): boolean {
  const now = validInstant(computedAt);
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  return checkins.some((checkin) => {
    if (checkin.attestationState !== "VERIFIED") return false;
    const checkedInAt = validInstant(checkin.checkedInAt);
    return checkedInAt >= cutoff && checkedInAt <= now;
  });
}

export function deriveHriInput(facts: RiskSubjectFacts, computedAt: Date): HriInput {
  const calculationYear = new Date(validInstant(computedAt) + KST_OFFSET_MS).getUTCFullYear();
  const age = calculationYear - facts.birthYear;
  if (!Number.isInteger(facts.birthYear) || age < 0 || age > 130) {
    throw new RangeError("Risk subject birth year is outside the supported range");
  }

  const medRegistered = facts.medicationProfileRegisteredAt !== null;
  const counts = medRegistered ? medicationCounts(facts.medications) : { high: 0, mid: 0 };

  return {
    feelsLikeC: facts.weather.feelsLikeC,
    heatAdvisory: facts.weather.heatAdvisory,
    tropicalNightStreak: facts.weather.tropicalNightStreak,
    medHigh: counts.high,
    medMid: counts.mid,
    medRegistered,
    age,
    livesAlone: facts.livesAlone,
    chronicDisease: facts.chronicDisease,
    noCooling: !facts.hasCooling,
    shelterCheckInVerified24h: hasVerifiedCheckinWithin24Hours(facts.shelterCheckins, computedAt),
  };
}

export function buildRiskInputHash(input: {
  readonly subjectId: string;
  readonly weatherSnapshotId: string;
  readonly bucketStart: string;
  readonly input: HriInput;
}): string {
  const normalized = {
    version: 1,
    subjectId: input.subjectId,
    weatherSnapshotId: input.weatherSnapshotId,
    bucketStart: input.bucketStart,
    hriInput: {
      feelsLikeC: input.input.feelsLikeC,
      heatAdvisory: input.input.heatAdvisory,
      tropicalNightStreak: input.input.tropicalNightStreak,
      medHigh: input.input.medHigh,
      medMid: input.input.medMid,
      medRegistered: input.input.medRegistered,
      age: input.input.age,
      livesAlone: input.input.livesAlone,
      chronicDisease: input.input.chronicDisease,
      noCooling: input.input.noCooling,
      shelterCheckInVerified24h: input.input.shelterCheckInVerified24h,
    },
  };
  return sha256(JSON.stringify(normalized));
}

export async function recomputeRiskSubject(input: {
  readonly subjectId: string;
  readonly computedAt: Date;
  readonly repository: RiskRecomputeRepository;
  readonly episodeIdFactory?: (seed: string) => string;
}): Promise<RecomputeRiskResult> {
  const computedAt = new Date(validInstant(input.computedAt)).toISOString();
  const [facts, history] = await Promise.all([
    input.repository.loadRiskFacts(input.subjectId, computedAt),
    input.repository.loadRiskHistory(input.subjectId, computedAt),
  ]);
  if (!facts || facts.subjectId !== input.subjectId) throw new RiskSubjectNotFoundError();

  const hriInput = deriveHriInput(facts, new Date(computedAt));
  const hri = computeHri(hriInput);
  const bucketStart = riskBucketStart(new Date(computedAt));
  const inputHash = buildRiskInputHash({
    subjectId: input.subjectId,
    weatherSnapshotId: facts.weather.snapshotId,
    bucketStart,
    input: hriInput,
  });
  const reasons = buildHriReasons(hriInput, hri);
  const snapshot: RiskSnapshotWrite = {
    subjectId: input.subjectId,
    weatherSnapshotId: facts.weather.snapshotId,
    hri: hri.score,
    level: hri.level,
    breakdown: hri.breakdown,
    reasons: reasons.length > 0 ? reasons : ["현재 가산 위험 요인이 없습니다"],
    inputHash,
    bucketStart,
    computedAt,
  };

  const episodeSeed = [
    input.subjectId,
    history.lastSafeSnapshot?.computedAt ?? "INITIAL",
    bucketStart,
    inputHash,
  ].join(":");
  const newEpisodeId = (input.episodeIdFactory ?? deterministicUuid)(episodeSeed);
  const transitionDecision = decideRiskTransition({
    subjectId: input.subjectId,
    currentLevel: hri.level,
    computedAt,
    history,
    newEpisodeId,
  });
  const commit = await input.repository.commitRiskComputation({
    snapshot,
    episodeMutation: transitionDecision.episodeMutation,
    transition: transitionDecision.transition,
  });

  return { hri, snapshot: commit.snapshot, transition: transitionDecision.transition, commit };
}
