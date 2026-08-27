export const RISK_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const MED_RISK_TIERS = ["HIGH", "MID", "NONE"] as const;
export type MedRiskTier = (typeof MED_RISK_TIERS)[number];

export const MED_SOURCES = ["AI_AUTO", "AI_CONFIRMED", "MANUAL"] as const;
export type MedSource = (typeof MED_SOURCES)[number];

export const ATTEST_STATES = ["UNVERIFIED", "PENDING", "VERIFIED", "FAILED"] as const;
export type AttestState = (typeof ATTEST_STATES)[number];

export const SHELTER_OPEN_STATES = ["OPEN", "CLOSED", "UNKNOWN"] as const;
export type ShelterOpen = (typeof SHELTER_OPEN_STATES)[number];

export const CROWD_LEVELS = ["SPARSE", "MODERATE", "CROWDED"] as const;
export type CrowdLevel = (typeof CROWD_LEVELS)[number];

export const HEAT_ADVISORIES = ["NONE", "WATCH", "WARNING"] as const;
export type HeatAdvisory = (typeof HEAT_ADVISORIES)[number];

export const ASYNC_STATES = [
  "idle",
  "loading",
  "refreshing",
  "success",
  "empty",
  "error",
  "partial",
] as const;
export type AsyncState = (typeof ASYNC_STATES)[number];
