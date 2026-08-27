import "@tanstack/react-start/server-only";

import type {
  GuardError,
  GuardRedirect,
  SubjectGuardInput,
  SubjectGuardResult,
} from "@/lib/auth/guards";
import { createPublicError } from "@/lib/error-dto";
import { ATTEST_STATES, MED_RISK_TIERS, MED_SOURCES, RISK_LEVELS } from "@/lib/domain-types";
import { levelOf } from "@/lib/risk/hri";
import { toMaskedSubjectDto, type SubjectPrivateRecord } from "@/lib/subjects/dto";

import {
  SUBJECT_CARE_EVENT_TYPES,
  SUBJECT_SEXES,
  type SubjectCareEventDto,
  type SubjectDetailDto,
  type SubjectMedicationDto,
  type SubjectRiskDto,
  type SubjectSex,
} from "./types";

export type SubjectDetailAccessAuthorizer = (
  input: SubjectGuardInput,
) => Promise<SubjectGuardResult>;

export type SubjectDetailRecord = Readonly<{
  subject: SubjectPrivateRecord &
    Readonly<{
      birthYear: number;
      sex: SubjectSex;
      livesAlone: boolean;
      seniorMode: boolean;
      medicationProfileRegisteredAt: string | null;
    }>;
  latestRisk: SubjectRiskDto | null;
  medications: readonly SubjectMedicationDto[];
  careEvents: readonly SubjectCareEventDto[];
}>;

export type SubjectDetailRepository = Readonly<{
  findSubjectDetailById(subjectId: string): Promise<SubjectDetailRecord | null>;
}>;

export type SubjectDetailReadResult =
  Readonly<{ kind: "success"; data: SubjectDetailDto }> | GuardRedirect | GuardError;

type SubjectDetailDependencies = Readonly<{
  authorizeSubject: SubjectDetailAccessAuthorizer;
  repository: SubjectDetailRepository;
  now?: Date;
}>;

function internalError(): GuardError {
  return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
}

function notFoundError(): GuardError {
  return { kind: "error", error: createPublicError("NOT_FOUND") };
}

function isFiniteIntegerWithin(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isValidRisk(risk: SubjectRiskDto): boolean {
  const { E, M, P, C } = risk.breakdown;
  const computed = Math.max(0, Math.min(100, E + M + P - C));

  return (
    isFiniteIntegerWithin(E, 0, 50) &&
    isFiniteIntegerWithin(M, 0, 25) &&
    isFiniteIntegerWithin(P, 0, 20) &&
    isFiniteIntegerWithin(C, 0, 6) &&
    isFiniteIntegerWithin(risk.score, 0, 100) &&
    computed === risk.score &&
    RISK_LEVELS.includes(risk.level) &&
    levelOf(risk.score) === risk.level &&
    risk.reasons.length >= 1 &&
    risk.reasons.length <= 3 &&
    risk.reasons.every((reason) => reason.trim().length > 0) &&
    isIsoTimestamp(risk.computedAt)
  );
}

function isValidMedication(medication: SubjectMedicationDto): boolean {
  return (
    medication.id.length > 0 &&
    medication.productName.trim().length > 0 &&
    MED_RISK_TIERS.includes(medication.riskTier) &&
    MED_SOURCES.includes(medication.source) &&
    (medication.confidence === null ||
      (Number.isFinite(medication.confidence) &&
        medication.confidence >= 0 &&
        medication.confidence <= 1)) &&
    isIsoTimestamp(medication.createdAt)
  );
}

function isValidCareEvent(event: SubjectCareEventDto): boolean {
  return (
    event.id.length > 0 &&
    SUBJECT_CARE_EVENT_TYPES.includes(event.type) &&
    RISK_LEVELS.includes(event.riskLevel) &&
    isFiniteIntegerWithin(event.hri, 0, 100) &&
    ATTEST_STATES.includes(event.attestationState) &&
    (event.attestationState !== "VERIFIED" || Boolean(event.attestationUid)) &&
    isIsoTimestamp(event.occurredAt)
  );
}

function ageInCalendarYears(birthYear: number, now: Date): number | null {
  const currentYear = now.getUTCFullYear();
  if (!isFiniteIntegerWithin(birthYear, 1900, currentYear)) return null;
  return currentYear - birthYear;
}

function toDetailDto(record: SubjectDetailRecord, now: Date): SubjectDetailDto | null {
  const age = ageInCalendarYears(record.subject.birthYear, now);
  if (
    age === null ||
    !SUBJECT_SEXES.includes(record.subject.sex) ||
    (record.latestRisk !== null && !isValidRisk(record.latestRisk)) ||
    !record.medications.every(isValidMedication) ||
    !record.careEvents.every(isValidCareEvent)
  ) {
    return null;
  }

  const masked = toMaskedSubjectDto(record.subject);
  return Object.freeze({
    subject: Object.freeze({
      ...masked,
      age,
      sex: record.subject.sex,
      livesAlone: record.subject.livesAlone,
      seniorMode: record.subject.seniorMode,
      medicationRegistered: record.subject.medicationProfileRegisteredAt !== null,
    }),
    latestRisk: record.latestRisk ? Object.freeze(record.latestRisk) : null,
    medications: Object.freeze(record.medications.map((medication) => Object.freeze(medication))),
    careEvents: Object.freeze(record.careEvents.map((event) => Object.freeze(event))),
  });
}

export async function getSubjectDetail(
  input: SubjectGuardInput,
  dependencies: SubjectDetailDependencies,
): Promise<SubjectDetailReadResult> {
  let access: SubjectGuardResult;
  try {
    access = await dependencies.authorizeSubject(input);
  } catch {
    return internalError();
  }

  if (access.kind !== "allow") return access;

  try {
    const record = await dependencies.repository.findSubjectDetailById(access.subject.id);
    if (!record) return notFoundError();
    if (
      record.subject.id !== access.subject.id ||
      record.subject.organizationId !== access.subject.organizationId
    ) {
      return internalError();
    }

    const data = toDetailDto(record, dependencies.now ?? new Date());
    if (!data) return internalError();

    return { kind: "success", data };
  } catch {
    return internalError();
  }
}
