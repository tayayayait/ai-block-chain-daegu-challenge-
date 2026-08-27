// F-01 · HRI (Heat Risk Index) 엔진
// HRI = clamp(0, 100, E + M + P − C)
import { z } from "zod";
import { HEAT_ADVISORIES, type RiskLevel } from "@/lib/domain-types";

export const HriInputSchema = z
  .object({
    feelsLikeC: z.number().finite().min(-80).max(80),
    heatAdvisory: z.enum(HEAT_ADVISORIES),
    tropicalNightStreak: z.number().int().min(0).max(366),
    medHigh: z.number().int().min(0).max(5),
    medMid: z.number().int().min(0).max(8),
    medRegistered: z.boolean(),
    age: z.number().int().min(0).max(130),
    livesAlone: z.boolean(),
    chronicDisease: z.boolean(),
    noCooling: z.boolean(),
    shelterCheckInVerified24h: z.boolean(),
  })
  .strict();

export type HriInput = z.infer<typeof HriInputSchema>;

export interface ScoreContribution {
  raw: number;
  applied: number;
}

export interface EnvironmentContributions {
  base: ScoreContribution;
  advisory: ScoreContribution;
  tropicalNight: ScoreContribution;
}

export interface MedicationContributions {
  high: ScoreContribution;
  mid: ScoreContribution;
  missingRegistration: boolean;
}

export interface PersonalContributions {
  age: ScoreContribution;
  livesAlone: ScoreContribution;
  chronicDisease: ScoreContribution;
  noCooling: ScoreContribution;
}

export interface MitigationContributions {
  verifiedShelterCheckIn: ScoreContribution;
}

export interface HriContributions {
  environment: EnvironmentContributions;
  medication: MedicationContributions;
  personal: PersonalContributions;
  mitigation: MitigationContributions;
}

export interface HriResult {
  score: number;
  level: RiskLevel;
  breakdown: { E: number; M: number; P: number; C: number };
  contributions: HriContributions;
}

export const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v));

export const levelOf = (score: number): RiskLevel =>
  score >= 80 ? "L4" : score >= 60 ? "L3" : score >= 40 ? "L2" : score >= 20 ? "L1" : "L0";

const appliedContribution = (raw: number, remaining: number): ScoreContribution => ({
  raw,
  applied: Math.min(raw, remaining),
});

export function computeHri(input: unknown): HriResult {
  const i = HriInputSchema.parse(input);

  // E — 환경 (0–50)
  const t = i.feelsLikeC;
  const baseRaw = t >= 40 ? 50 : t >= 38 ? 42 : t >= 35 ? 32 : t >= 33 ? 20 : t >= 31 ? 10 : 0;
  const advisoryRaw = i.heatAdvisory === "WARNING" ? 5 : i.heatAdvisory === "WATCH" ? 3 : 0;
  const tropicalNightRaw = i.tropicalNightStreak >= 3 ? 5 : 0;
  const base = appliedContribution(baseRaw, 50);
  const advisory = appliedContribution(advisoryRaw, 50 - base.applied);
  const tropicalNight = appliedContribution(tropicalNightRaw, 50 - base.applied - advisory.applied);
  const environment = { base, advisory, tropicalNight };
  const E = base.applied + advisory.applied + tropicalNight.applied;

  // M — 복약 (0–25)
  const highRaw = i.medRegistered ? i.medHigh * 6 : 0;
  const midRaw = i.medRegistered ? i.medMid * 3 : 0;
  const high = appliedContribution(highRaw, 25);
  const mid = appliedContribution(midRaw, 25 - high.applied);
  const medication = { high, mid, missingRegistration: !i.medRegistered };
  const M = high.applied + mid.applied;

  // P — 개인 (0–20)
  const ageRaw = i.age >= 85 ? 8 : i.age >= 75 ? 5 : i.age >= 65 ? 3 : 0;
  const livesAloneRaw = i.livesAlone ? 5 : 0;
  const chronicDiseaseRaw = i.chronicDisease ? 4 : 0;
  const noCoolingRaw = i.noCooling ? 3 : 0;
  const age = appliedContribution(ageRaw, 20);
  const livesAlone = appliedContribution(livesAloneRaw, 20 - age.applied);
  const chronicDisease = appliedContribution(
    chronicDiseaseRaw,
    20 - age.applied - livesAlone.applied,
  );
  const noCooling = appliedContribution(
    noCoolingRaw,
    20 - age.applied - livesAlone.applied - chronicDisease.applied,
  );
  const personal = { age, livesAlone, chronicDisease, noCooling };
  const P = age.applied + livesAlone.applied + chronicDisease.applied + noCooling.applied;

  // C — 완화 (0–6). 온체인 검증된 체크인만 차감 (규칙 E-1)
  const verifiedShelterCheckInRaw = i.shelterCheckInVerified24h ? 6 : 0;
  const verifiedShelterCheckIn = appliedContribution(verifiedShelterCheckInRaw, 6);
  const mitigation = { verifiedShelterCheckIn };
  const C = verifiedShelterCheckIn.applied;

  const score = clamp(0, 100, E + M + P - C);
  const breakdown = { E, M, P, C };

  return {
    score,
    level: levelOf(score),
    breakdown,
    contributions: { environment, medication, personal, mitigation },
  };
}
