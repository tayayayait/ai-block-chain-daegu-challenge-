import type { AttestState, MedRiskTier, MedSource, RiskLevel } from "@/lib/domain-types";
import type { GuardError, GuardRedirect } from "@/lib/auth/guards";
import type { FullSubjectPiiDto } from "@/lib/subjects/dto";

export const SUBJECT_SEXES = ["FEMALE", "MALE", "OTHER", "UNDISCLOSED"] as const;
export type SubjectSex = (typeof SUBJECT_SEXES)[number];

export type SubjectDetailIdentityDto = Readonly<{
  id: string;
  maskedName: string;
  shortAddress: string;
  maskedPhone: string;
  age: number;
  sex: SubjectSex;
  livesAlone: boolean;
  seniorMode: boolean;
  medicationRegistered: boolean;
}>;

export type SubjectRiskDto = Readonly<{
  score: number;
  level: RiskLevel;
  breakdown: Readonly<{ E: number; M: number; P: number; C: number }>;
  reasons: readonly string[];
  computedAt: string;
}>;

export type SubjectMedicationDto = Readonly<{
  id: string;
  productName: string;
  heatClass: string | null;
  riskTier: MedRiskTier;
  source: MedSource;
  confidence: number | null;
  createdAt: string;
}>;

export const SUBJECT_CARE_EVENT_TYPES = ["VISIT", "SHELTER_CHECKIN", "ALERT_SENT"] as const;
export type SubjectCareEventType = (typeof SUBJECT_CARE_EVENT_TYPES)[number];

export type SubjectCareEventDto = Readonly<{
  id: string;
  type: SubjectCareEventType;
  riskLevel: RiskLevel;
  hri: number;
  occurredAt: string;
  attestationState: AttestState;
  attestationUid: string | null;
  issuer: string | null;
}>;

export type SubjectDetailDto = Readonly<{
  subject: SubjectDetailIdentityDto;
  latestRisk: SubjectRiskDto | null;
  medications: readonly SubjectMedicationDto[];
  careEvents: readonly SubjectCareEventDto[];
}>;

export type SubjectPiiRevealResult =
  Readonly<{ kind: "success"; data: FullSubjectPiiDto }> | GuardError | GuardRedirect;

export type FeatureLinkReadiness = Readonly<
  | { ready: false }
  | {
      ready: true;
      href: string;
    }
>;

export type SubjectDetailFeatureReadiness = Readonly<{
  medicationCapture: FeatureLinkReadiness;
  shelterRouting: FeatureLinkReadiness;
  guardianAlert: FeatureLinkReadiness;
  attestationVerification: FeatureLinkReadiness;
}>;

export const SUBJECT_DETAIL_FEATURES_PENDING: SubjectDetailFeatureReadiness = Object.freeze({
  medicationCapture: Object.freeze({ ready: false }),
  shelterRouting: Object.freeze({ ready: false }),
  guardianAlert: Object.freeze({ ready: false }),
  attestationVerification: Object.freeze({ ready: false }),
});
