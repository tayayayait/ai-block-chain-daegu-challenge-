import "@tanstack/react-start/server-only";

import { createHmac } from "node:crypto";
import { z } from "zod";

import type { SubjectGuardInput, SubjectGuardResult } from "@/lib/auth/guards";
import { ShelterIdSchema } from "@/lib/shelters/public-dto";
import {
  CheckInPolicyError,
  createPendingShelterCheckIn,
  type CheckInActor,
} from "./check-in-policy";
import { CheckInRepositoryError, type CheckInRepository } from "./check-in-repository.server";

const UuidSchema = z.string().uuid();
const ClientRequestIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const CheckInInputSchema = z
  .object({
    subjectId: UuidSchema,
    shelterId: ShelterIdSchema,
    clientRequestId: ClientRequestIdSchema,
  })
  .strict();
const SubjectAccessTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u);
const ResolvedSubjectSessionSchema = z
  .object({
    sessionId: UuidSchema,
    subjectId: UuidSchema,
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
const StaffAccessSchema = z
  .object({
    kind: z.literal("allow"),
    profile: z
      .object({
        id: UuidSchema,
        organizationId: UuidSchema,
        role: z.enum(["ADMIN", "CARE_WORKER"]),
      })
      .strict(),
    subject: z.object({ id: UuidSchema, organizationId: UuidSchema }).strict(),
  })
  .strict();
const CheckInPrincipalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PUBLIC") }).strict(),
  z.object({ kind: z.literal("STAFF_SESSION"), userId: UuidSchema.nullable() }).strict(),
  z.object({ kind: z.literal("SUBJECT_SESSION"), accessToken: z.string() }).strict(),
]);

export type CheckInPrincipal = Readonly<z.infer<typeof CheckInPrincipalSchema>>;

export interface ResolvedSubjectSession {
  readonly sessionId: string;
  readonly subjectId: string;
  readonly expiresAt: string;
}

export interface CheckInServiceDependencies {
  readonly authorizeSubject: (input: SubjectGuardInput) => Promise<SubjectGuardResult>;
  readonly resolveSubjectSession: (
    input: Readonly<{
      accessToken: string;
      subjectId: string;
      now: string;
    }>,
  ) => Promise<ResolvedSubjectSession | null>;
  readonly repository: CheckInRepository;
  readonly actorHashSecret: string;
  readonly now?: () => Date;
}

export interface CheckInSubmissionResult {
  readonly checkInId: string;
  readonly attestationState: "PENDING";
  readonly displayStatus: "기록 확인 중";
  readonly contribution: 0;
}

export type CheckInServiceErrorCode =
  | "INVALID_REQUEST"
  | "AUTHENTICATION_REQUIRED"
  | "SUBJECT_FORBIDDEN"
  | "SUBJECT_SESSION_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "NOT_FOUND"
  | "SERVER_TEMPORARY";

export class CheckInServiceError extends Error {
  constructor(
    readonly code: CheckInServiceErrorCode,
    readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(`Shelter check-in failed: ${code}`);
    this.name = "CheckInServiceError";
  }
}

export function hashCheckInActorReference(reference: string, secret: string): string {
  const parsedReference = UuidSchema.safeParse(reference);
  if (!parsedReference.success || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("CHECK_IN_ACTOR_HASH_CONFIGURATION_INVALID");
  }
  return createHmac("sha256", secret)
    .update(`shelter-checkin-actor:v1\0${parsedReference.data}`, "utf8")
    .digest("hex");
}

async function resolveStaffActor(
  subjectId: string,
  principal: Extract<CheckInPrincipal, { kind: "STAFF_SESSION" }>,
  dependencies: CheckInServiceDependencies,
): Promise<CheckInActor> {
  let access: SubjectGuardResult;
  try {
    access = await dependencies.authorizeSubject({
      userId: principal.userId,
      subjectId,
      nextPath: `/subjects/${encodeURIComponent(subjectId)}`,
    });
  } catch {
    throw new CheckInServiceError("SERVER_TEMPORARY", 503);
  }
  if (access.kind === "redirect") {
    throw new CheckInServiceError("AUTHENTICATION_REQUIRED", 403);
  }
  if (access.kind === "error") {
    throw access.error.code === "NOT_FOUND"
      ? new CheckInServiceError("SUBJECT_FORBIDDEN", 403)
      : new CheckInServiceError("SERVER_TEMPORARY", 503);
  }
  const parsedAccess = StaffAccessSchema.safeParse(access);
  if (
    !parsedAccess.success ||
    parsedAccess.data.subject.id !== subjectId ||
    parsedAccess.data.subject.organizationId !== parsedAccess.data.profile.organizationId
  ) {
    throw new CheckInServiceError("SERVER_TEMPORARY", 503);
  }
  return {
    kind: "STAFF",
    profileId: parsedAccess.data.profile.id,
    permittedSubjectIds: [parsedAccess.data.subject.id],
  };
}

async function resolveSubjectSessionActor(
  subjectId: string,
  principal: Extract<CheckInPrincipal, { kind: "SUBJECT_SESSION" }>,
  checkedInAt: Date,
  dependencies: CheckInServiceDependencies,
): Promise<CheckInActor> {
  const accessToken = SubjectAccessTokenSchema.safeParse(principal.accessToken);
  if (!accessToken.success) throw new CheckInServiceError("SUBJECT_SESSION_INVALID", 403);
  let rawSession: ResolvedSubjectSession | null;
  try {
    rawSession = await dependencies.resolveSubjectSession({
      accessToken: accessToken.data,
      subjectId,
      now: checkedInAt.toISOString(),
    });
  } catch {
    throw new CheckInServiceError("SERVER_TEMPORARY", 503);
  }
  if (rawSession === null) throw new CheckInServiceError("SUBJECT_SESSION_INVALID", 403);
  const session = ResolvedSubjectSessionSchema.safeParse(rawSession);
  if (!session.success) throw new CheckInServiceError("SERVER_TEMPORARY", 503);
  return {
    kind: "SUBJECT_SESSION",
    sessionId: session.data.sessionId,
    subjectId: session.data.subjectId,
    expiresAt: new Date(session.data.expiresAt),
    now: checkedInAt,
  };
}

export async function submitShelterCheckIn(
  rawInput: unknown,
  principal: CheckInPrincipal,
  dependencies: CheckInServiceDependencies,
): Promise<CheckInSubmissionResult> {
  const parsedInput = CheckInInputSchema.safeParse(rawInput);
  if (!parsedInput.success) throw new CheckInServiceError("INVALID_REQUEST", 400);
  const input = parsedInput.data;
  const parsedPrincipal = CheckInPrincipalSchema.safeParse(principal);
  if (!parsedPrincipal.success) throw new CheckInServiceError("INVALID_REQUEST", 400);
  const trustedPrincipal = parsedPrincipal.data;
  const checkedInAt = dependencies.now?.() ?? new Date();
  const actor =
    trustedPrincipal.kind === "STAFF_SESSION"
      ? await resolveStaffActor(input.subjectId, trustedPrincipal, dependencies)
      : trustedPrincipal.kind === "SUBJECT_SESSION"
        ? await resolveSubjectSessionActor(
            input.subjectId,
            trustedPrincipal,
            checkedInAt,
            dependencies,
          )
        : ({ kind: "PUBLIC" } as const);
  let pending: Awaited<ReturnType<typeof createPendingShelterCheckIn>>;
  try {
    pending = await createPendingShelterCheckIn(
      { ...input, checkedInAt, actor },
      {
        actorHash: async (reference) =>
          hashCheckInActorReference(reference, dependencies.actorHashSecret),
        insertPending: (write) => dependencies.repository.createPending(write),
      },
    );
  } catch (error) {
    if (error instanceof CheckInServiceError) throw error;
    if (error instanceof CheckInPolicyError && error.code === "AUTHENTICATION_REQUIRED") {
      throw new CheckInServiceError("AUTHENTICATION_REQUIRED", 403);
    }
    if (
      error instanceof CheckInPolicyError &&
      (error.code === "SUBJECT_SESSION_MISMATCH" || error.code === "SUBJECT_SESSION_EXPIRED")
    ) {
      throw new CheckInServiceError("SUBJECT_SESSION_INVALID", 403);
    }
    if (error instanceof CheckInPolicyError && error.code === "SUBJECT_FORBIDDEN") {
      throw new CheckInServiceError("SUBJECT_FORBIDDEN", 403);
    }
    if (error instanceof CheckInRepositoryError) {
      if (error.code === "IDEMPOTENCY_CONFLICT") {
        throw new CheckInServiceError("IDEMPOTENCY_CONFLICT", 409);
      }
      if (error.code === "NOT_FOUND") throw new CheckInServiceError("NOT_FOUND", 404);
      if (error.code === "INVALID_REQUEST") {
        throw new CheckInServiceError("INVALID_REQUEST", 400);
      }
      throw new CheckInServiceError("SERVER_TEMPORARY", 503);
    }
    throw new CheckInServiceError("SERVER_TEMPORARY", 503);
  }

  return Object.freeze({
    checkInId: pending.id,
    attestationState: "PENDING",
    displayStatus: "기록 확인 중",
    contribution: 0,
  });
}
