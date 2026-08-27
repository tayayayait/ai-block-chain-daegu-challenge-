import "@tanstack/react-start/server-only";

import type { StaffProfile, SubjectScope } from "../auth/access-policy";
import type {
  GuardError,
  GuardRedirect,
  SubjectGuardInput,
  SubjectGuardResult,
} from "../auth/guards";
import { createPublicError } from "../error-dto";
import {
  toMaskedSubjectDto,
  type FullSubjectPiiDto,
  type MaskedSubjectDto,
  type SubjectPrivateRecord,
} from "./dto";

export const FULL_PII_PURPOSES = [
  "CARE_COORDINATION",
  "MEDICATION_REVIEW",
  "EMERGENCY_RESPONSE",
] as const;

export type FullPiiPurpose = (typeof FULL_PII_PURPOSES)[number];

export type SubjectAccessAuthorizer = (input: SubjectGuardInput) => Promise<SubjectGuardResult>;

export type FullPiiAuthorizer = (input: {
  profile: StaffProfile;
  subject: SubjectScope;
  purpose: FullPiiPurpose;
}) => Promise<boolean>;

export type SubjectRepository = Readonly<{
  findPrivateSubjectById(subjectId: string): Promise<SubjectPrivateRecord | null>;
}>;

export type SubjectReadSuccess<T> = Readonly<{
  kind: "success";
  data: T;
}>;

export type SubjectReadResult<T> = SubjectReadSuccess<T> | GuardRedirect | GuardError;

type MaskedSubjectDependencies = Readonly<{
  authorizeSubject: SubjectAccessAuthorizer;
  repository: SubjectRepository;
}>;

type FullSubjectDependencies = MaskedSubjectDependencies &
  Readonly<{
    authorizeFullPii: FullPiiAuthorizer;
  }>;

type FullSubjectInput = SubjectGuardInput &
  Readonly<{
    purpose: FullPiiPurpose;
  }>;

function internalError(): GuardError {
  return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
}

function notFoundError(): GuardError {
  return { kind: "error", error: createPublicError("NOT_FOUND") };
}

function isRecordInAuthorizedScope(record: SubjectPrivateRecord, subject: SubjectScope): boolean {
  return record.id === subject.id && record.organizationId === subject.organizationId;
}

async function authorizeSubjectSafely(
  input: SubjectGuardInput,
  authorizeSubject: SubjectAccessAuthorizer,
): Promise<SubjectGuardResult> {
  try {
    return await authorizeSubject(input);
  } catch {
    return internalError();
  }
}

export async function getMaskedSubject(
  input: SubjectGuardInput,
  dependencies: MaskedSubjectDependencies,
): Promise<SubjectReadResult<MaskedSubjectDto>> {
  const access = await authorizeSubjectSafely(input, dependencies.authorizeSubject);
  if (access.kind !== "allow") {
    return access;
  }

  try {
    const record = await dependencies.repository.findPrivateSubjectById(access.subject.id);
    if (!record || !isRecordInAuthorizedScope(record, access.subject)) {
      return notFoundError();
    }

    return { kind: "success", data: toMaskedSubjectDto(record) };
  } catch {
    return internalError();
  }
}

export async function getFullSubjectPii(
  input: FullSubjectInput,
  dependencies: FullSubjectDependencies,
): Promise<SubjectReadResult<FullSubjectPiiDto>> {
  const access = await authorizeSubjectSafely(input, dependencies.authorizeSubject);
  if (access.kind !== "allow") {
    return access;
  }

  try {
    const fullPiiAllowed = await dependencies.authorizeFullPii({
      profile: access.profile,
      subject: access.subject,
      purpose: input.purpose,
    });
    if (!fullPiiAllowed) {
      return notFoundError();
    }

    const record = await dependencies.repository.findPrivateSubjectById(access.subject.id);
    if (!record || !isRecordInAuthorizedScope(record, access.subject)) {
      return notFoundError();
    }

    return {
      kind: "success",
      data: Object.freeze({
        id: record.id,
        name: record.name,
        address: record.address,
        phone: record.phone,
      }),
    };
  } catch {
    return internalError();
  }
}
