import type { AttestState, HeatAdvisory, RiskLevel } from "@/lib/domain-types";

import type { DashboardSearch } from "./search";

export type DashboardSource = "SUPABASE" | "DEMO_FIXTURE";

/** Authenticated dashboard DTO. It deliberately contains no direct contact or full-address PII. */
export interface DashboardSubject {
  id: string;
  maskedName: string;
  age: number;
  livesAlone: boolean;
  gu: string;
  locationLabel: string;
  level: RiskLevel;
  hri: number;
  feelsLikeC: number;
  reasons: readonly string[];
  updatedAt: string;
}

export interface DashboardCareEvent {
  /** Local database identity; never presented as an EAS attestation identifier. */
  id: string;
  /** Present only after the chain receipt has produced a real EAS UID. */
  attestationUid: string | null;
  typeLabel: string;
  occurredAt: string;
  attest: AttestState;
}

export interface DashboardL4Alert {
  transitionId: string;
  subjectId: string;
  maskedName: string;
  age: number;
  hri: number;
  occurredAt: string;
}

export interface DashboardSummary {
  total: number;
  averageHri: number;
  byLevel: Readonly<Record<"L2" | "L3" | "L4", number>>;
}

export interface DashboardWeather {
  gu: string;
  feelsLikeC: number;
  advisory: HeatAdvisory;
  observedAt: string;
  isPartial: boolean;
  isStale: boolean;
}

export interface DashboardSnapshot {
  source: DashboardSource;
  filter: DashboardSearch;
  summary: DashboardSummary;
  weather: DashboardWeather | null;
  urgentSubjects: readonly DashboardSubject[];
  mapSubjects: readonly DashboardSubject[];
  careEvents: readonly DashboardCareEvent[];
  unreadL4Alerts: readonly DashboardL4Alert[];
  missingSources: readonly string[];
  fetchedAt: string;
}
