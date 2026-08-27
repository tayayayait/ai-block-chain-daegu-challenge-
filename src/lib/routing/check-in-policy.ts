import type { AttestState } from "@/lib/domain-types";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1_000;

export type CheckInActor =
  | { readonly kind: "PUBLIC" }
  | {
      readonly kind: "STAFF";
      readonly profileId: string;
      readonly permittedSubjectIds: readonly string[];
    }
  | {
      readonly kind: "SUBJECT_SESSION";
      readonly sessionId: string;
      readonly subjectId: string;
      readonly expiresAt: Date;
      readonly now: Date;
    };

type CheckInAuthorization =
  | {
      readonly allowed: true;
      readonly actorScope: "CAREGIVER" | "SUBJECT_SCOPED";
      readonly actorReference: string;
    }
  | {
      readonly allowed: false;
      readonly reason:
        | "AUTHENTICATION_REQUIRED"
        | "SUBJECT_FORBIDDEN"
        | "SUBJECT_SESSION_MISMATCH"
        | "SUBJECT_SESSION_EXPIRED";
    };

export function authorizeCheckIn(subjectId: string, actor: CheckInActor): CheckInAuthorization {
  if (actor.kind === "PUBLIC") return { allowed: false, reason: "AUTHENTICATION_REQUIRED" };
  if (actor.kind === "STAFF") {
    return actor.permittedSubjectIds.includes(subjectId)
      ? { allowed: true, actorScope: "CAREGIVER", actorReference: actor.profileId }
      : { allowed: false, reason: "SUBJECT_FORBIDDEN" };
  }
  if (actor.subjectId !== subjectId) return { allowed: false, reason: "SUBJECT_SESSION_MISMATCH" };
  if (
    !Number.isFinite(actor.expiresAt.getTime()) ||
    !Number.isFinite(actor.now.getTime()) ||
    actor.expiresAt.getTime() <= actor.now.getTime()
  ) {
    return { allowed: false, reason: "SUBJECT_SESSION_EXPIRED" };
  }
  return { allowed: true, actorScope: "SUBJECT_SCOPED", actorReference: actor.sessionId };
}

export class CheckInPolicyError extends Error {
  constructor(readonly code: string) {
    super(`Shelter check-in rejected: ${code}`);
    this.name = "CheckInPolicyError";
  }
}

interface PendingCheckInRecord {
  readonly id: string;
  readonly attestationState: "PENDING";
  readonly checkedInAt: Date;
}

interface PendingCheckInInput {
  readonly subjectId: string;
  readonly shelterId: string;
  readonly checkedInAt: Date;
  readonly clientRequestId: string;
  readonly actor: CheckInActor;
}

interface PendingCheckInDependencies {
  readonly actorHash: (reference: string) => Promise<string>;
  readonly insertPending: (
    input: Readonly<{
      subjectId: string;
      shelterId: string;
      checkedInAt: Date;
      clientRequestId: string;
      actorScope: "CAREGIVER" | "SUBJECT_SCOPED";
      actorRefHash: string;
      attestationState: "PENDING";
    }>,
  ) => Promise<PendingCheckInRecord>;
}

export async function createPendingShelterCheckIn(
  input: PendingCheckInInput,
  dependencies: PendingCheckInDependencies,
) {
  const authorization = authorizeCheckIn(input.subjectId, input.actor);
  if (!authorization.allowed) throw new CheckInPolicyError(authorization.reason);
  const actorRefHash = await dependencies.actorHash(authorization.actorReference);
  if (!/^[0-9a-f]{64}$/u.test(actorRefHash)) throw new CheckInPolicyError("INVALID_ACTOR_HASH");
  const record = await dependencies.insertPending({
    subjectId: input.subjectId,
    shelterId: input.shelterId,
    checkedInAt: input.checkedInAt,
    clientRequestId: input.clientRequestId,
    actorScope: authorization.actorScope,
    actorRefHash,
    attestationState: "PENDING",
  });
  if (record.attestationState !== "PENDING") throw new CheckInPolicyError("INVALID_INITIAL_STATE");
  return { ...record, displayStatus: "RECORDING_PENDING" as const, contribution: 0 as const };
}

export function checkInMitigationStatus(
  input: Readonly<{
    attestationState: AttestState;
    checkedInAt: Date;
    verifiedAt?: Date;
    computedAt: Date;
  }>,
) {
  if (input.attestationState !== "VERIFIED") {
    return { displayStatus: "RECORDING_PENDING" as const, contribution: 0 as const };
  }
  const checkedInAt = input.checkedInAt.getTime();
  const verifiedAt = input.verifiedAt?.getTime() ?? Number.NaN;
  const computedAt = input.computedAt.getTime();
  if (
    !Number.isFinite(checkedInAt) ||
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(computedAt)
  ) {
    return { displayStatus: "VERIFIED_AWAITING_RECOMPUTE" as const, contribution: 0 as const };
  }
  const checkInAge = computedAt - checkedInAt;
  if (computedAt < verifiedAt || checkInAge < 0 || checkInAge > TWENTY_FOUR_HOURS_MS) {
    return { displayStatus: "VERIFIED_AWAITING_RECOMPUTE" as const, contribution: 0 as const };
  }
  return { displayStatus: "MITIGATION_APPLIED" as const, contribution: 6 as const };
}
