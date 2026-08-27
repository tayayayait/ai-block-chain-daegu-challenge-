import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { SubjectGuardResult } from "@/lib/auth/guards";
import { createPublicError } from "@/lib/error-dto";
import {
  CheckInRepositoryError,
  type CheckInRepository,
  type PendingCheckInWrite,
} from "./check-in-repository.server";
import { CheckInServiceError, submitShelterCheckIn } from "./check-in-service.server";

const SUBJECT_ID = "10000000-0000-4000-8000-000000000001";
const PROFILE_ID = "20000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "30000000-0000-4000-8000-000000000001";
const CLIENT_REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const CHECK_IN_ID = "50000000-0000-4000-8000-000000000001";
const SUBJECT_SESSION_ID = "60000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-24T04:00:00.000Z");
// secret-scan: allow-next-line -- test-fixture
const HMAC_SECRET = "test-only-check-in-secret-at-least-thirty-two-bytes";
// secret-scan: allow-next-line -- test-fixture
const SUBJECT_ACCESS_TOKEN = "a".repeat(43);

function allowStaff(): SubjectGuardResult {
  return {
    kind: "allow",
    profile: { id: PROFILE_ID, organizationId: ORGANIZATION_ID, role: "CARE_WORKER" },
    subject: { id: SUBJECT_ID, organizationId: ORGANIZATION_ID },
  };
}

function expectedActorHash(reference: string): string {
  return createHmac("sha256", HMAC_SECRET)
    .update(`shelter-checkin-actor:v1\0${reference}`, "utf8")
    .digest("hex");
}

describe("shelter check-in service", () => {
  it("authorizes an assigned staff member, HMACs the actor, and returns only pending UI state", async () => {
    const authorizeSubject = vi.fn(async () => allowStaff());
    const createPending = vi.fn(async (_input: PendingCheckInWrite) => ({
      id: CHECK_IN_ID,
      attestationState: "PENDING" as const,
      checkedInAt: NOW,
      jobState: "PENDING" as const,
    }));
    const repository = { createPending } satisfies CheckInRepository;

    const result = await submitShelterCheckIn(
      {
        subjectId: SUBJECT_ID,
        shelterId: "DG-0001",
        clientRequestId: CLIENT_REQUEST_ID,
      },
      { kind: "STAFF_SESSION", userId: PROFILE_ID },
      {
        authorizeSubject,
        resolveSubjectSession: vi.fn(),
        repository,
        actorHashSecret: HMAC_SECRET,
        now: () => NOW,
      },
    );

    expect(authorizeSubject).toHaveBeenCalledWith({
      userId: PROFILE_ID,
      subjectId: SUBJECT_ID,
      nextPath: `/subjects/${SUBJECT_ID}`,
    });
    expect(createPending).toHaveBeenCalledWith({
      subjectId: SUBJECT_ID,
      shelterId: "DG-0001",
      checkedInAt: NOW,
      clientRequestId: CLIENT_REQUEST_ID,
      actorScope: "CAREGIVER",
      actorRefHash: expectedActorHash(PROFILE_ID),
      attestationState: "PENDING",
    });
    expect(result).toEqual({
      checkInId: CHECK_IN_ID,
      attestationState: "PENDING",
      displayStatus: "기록 확인 중",
      contribution: 0,
    });
    expect(JSON.stringify(result)).not.toContain(PROFILE_ID);
    expect(JSON.stringify(result)).not.toContain(SUBJECT_ID);
    expect(JSON.stringify(result)).not.toContain(HMAC_SECRET);
  });

  it("rejects a public caller with 403 and performs no authorization, hashing, or write", async () => {
    const authorizeSubject = vi.fn();
    const resolveSubjectSession = vi.fn();
    const createPending = vi.fn();

    await expect(
      submitShelterCheckIn(
        {
          subjectId: SUBJECT_ID,
          shelterId: "DG-0001",
          clientRequestId: CLIENT_REQUEST_ID,
        },
        { kind: "PUBLIC" },
        {
          authorizeSubject,
          resolveSubjectSession,
          repository: { createPending },
          actorHashSecret: HMAC_SECRET,
          now: () => NOW,
        },
      ),
    ).rejects.toEqual(new CheckInServiceError("AUTHENTICATION_REQUIRED", 403));
    expect(authorizeSubject).not.toHaveBeenCalled();
    expect(resolveSubjectSession).not.toHaveBeenCalled();
    expect(createPending).not.toHaveBeenCalled();
  });

  it("accepts only a server-resolved live subject-scoped session and hashes its session id", async () => {
    const authorizeSubject = vi.fn();
    const resolveSubjectSession = vi.fn(async () => ({
      sessionId: SUBJECT_SESSION_ID,
      subjectId: SUBJECT_ID,
      expiresAt: "2026-08-24T05:00:00.000Z",
    }));
    const createPending = vi.fn(async (_input: PendingCheckInWrite) => ({
      id: CHECK_IN_ID,
      attestationState: "PENDING" as const,
      checkedInAt: NOW,
      jobState: "PENDING" as const,
    }));

    const result = await submitShelterCheckIn(
      {
        subjectId: SUBJECT_ID,
        shelterId: "DG-0001",
        clientRequestId: CLIENT_REQUEST_ID,
      },
      { kind: "SUBJECT_SESSION", accessToken: SUBJECT_ACCESS_TOKEN },
      {
        authorizeSubject,
        resolveSubjectSession,
        repository: { createPending },
        actorHashSecret: HMAC_SECRET,
        now: () => NOW,
      },
    );

    expect(resolveSubjectSession).toHaveBeenCalledWith({
      accessToken: SUBJECT_ACCESS_TOKEN,
      subjectId: SUBJECT_ID,
      now: NOW.toISOString(),
    });
    expect(authorizeSubject).not.toHaveBeenCalled();
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        actorScope: "SUBJECT_SCOPED",
        actorRefHash: expectedActorHash(SUBJECT_SESSION_ID),
      }),
    );
    expect(JSON.stringify(createPending.mock.calls[0]?.[0])).not.toContain(SUBJECT_ACCESS_TOKEN);
    expect(result).toMatchObject({ attestationState: "PENDING", contribution: 0 });
  });

  it("strictly rejects malformed or over-posted idempotent input before any dependency runs", async () => {
    const authorizeSubject = vi.fn();
    const resolveSubjectSession = vi.fn();
    const createPending = vi.fn();

    await expect(
      submitShelterCheckIn(
        {
          subjectId: SUBJECT_ID,
          shelterId: "DG-0001",
          clientRequestId: "40000000-0000-1000-8000-000000000001",
          checkedInAt: "2026-08-24T04:00:00.000Z",
        },
        { kind: "STAFF_SESSION", userId: PROFILE_ID },
        {
          authorizeSubject,
          resolveSubjectSession,
          repository: { createPending },
          actorHashSecret: HMAC_SECRET,
          now: () => NOW,
        },
      ),
    ).rejects.toEqual(new CheckInServiceError("INVALID_REQUEST", 400));
    expect(authorizeSubject).not.toHaveBeenCalled();
    expect(resolveSubjectSession).not.toHaveBeenCalled();
    expect(createPending).not.toHaveBeenCalled();
  });

  it("fails closed for unauthenticated, forbidden, or broken staff authorization", async () => {
    const input = {
      subjectId: SUBJECT_ID,
      shelterId: "DG-0001",
      clientRequestId: CLIENT_REQUEST_ID,
    };
    const createPending = vi.fn();
    const dependencies = (result: SubjectGuardResult) => ({
      authorizeSubject: vi.fn(async () => result),
      resolveSubjectSession: vi.fn(),
      repository: { createPending },
      actorHashSecret: HMAC_SECRET,
      now: () => NOW,
    });

    await expect(
      submitShelterCheckIn(
        input,
        { kind: "STAFF_SESSION", userId: null },
        dependencies({ kind: "redirect", href: "/login?next=%2Fdashboard" }),
      ),
    ).rejects.toEqual(new CheckInServiceError("AUTHENTICATION_REQUIRED", 403));
    await expect(
      submitShelterCheckIn(
        input,
        { kind: "STAFF_SESSION", userId: PROFILE_ID },
        dependencies({ kind: "error", error: createPublicError("NOT_FOUND") }),
      ),
    ).rejects.toEqual(new CheckInServiceError("SUBJECT_FORBIDDEN", 403));
    await expect(
      submitShelterCheckIn(
        input,
        { kind: "STAFF_SESSION", userId: PROFILE_ID },
        dependencies({ kind: "error", error: createPublicError("INTERNAL_ERROR") }),
      ),
    ).rejects.toEqual(new CheckInServiceError("SERVER_TEMPORARY", 503));
    expect(createPending).not.toHaveBeenCalled();
  });

  it("maps subject-session resolver failures to a stable error without leaking token diagnostics", async () => {
    const secretDiagnostic = `resolver-failed-for-${SUBJECT_ACCESS_TOKEN}`;
    const createPending = vi.fn();
    const error = await submitShelterCheckIn(
      {
        subjectId: SUBJECT_ID,
        shelterId: "DG-0001",
        clientRequestId: CLIENT_REQUEST_ID,
      },
      { kind: "SUBJECT_SESSION", accessToken: SUBJECT_ACCESS_TOKEN },
      {
        authorizeSubject: vi.fn(),
        resolveSubjectSession: vi.fn(async () => {
          throw new Error(secretDiagnostic);
        }),
        repository: { createPending },
        actorHashSecret: HMAC_SECRET,
        now: () => NOW,
      },
    ).catch((reason: unknown) => reason);

    expect(error).toEqual(new CheckInServiceError("SERVER_TEMPORARY", 503));
    expect(JSON.stringify(error)).not.toContain(SUBJECT_ACCESS_TOKEN);
    expect(createPending).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    [
      "different subject",
      {
        sessionId: SUBJECT_SESSION_ID,
        subjectId: "10000000-0000-4000-8000-000000000099",
        expiresAt: "2026-08-24T05:00:00.000Z",
      },
    ],
    [
      "expired",
      {
        sessionId: SUBJECT_SESSION_ID,
        subjectId: SUBJECT_ID,
        expiresAt: NOW.toISOString(),
      },
    ],
  ] as const)("rejects a %s subject-scoped session without writing", async (_case, session) => {
    const createPending = vi.fn();

    await expect(
      submitShelterCheckIn(
        {
          subjectId: SUBJECT_ID,
          shelterId: "DG-0001",
          clientRequestId: CLIENT_REQUEST_ID,
        },
        { kind: "SUBJECT_SESSION", accessToken: SUBJECT_ACCESS_TOKEN },
        {
          authorizeSubject: vi.fn(),
          resolveSubjectSession: vi.fn(async () => session),
          repository: { createPending },
          actorHashSecret: HMAC_SECRET,
          now: () => NOW,
        },
      ),
    ).rejects.toEqual(new CheckInServiceError("SUBJECT_SESSION_INVALID", 403));
    expect(createPending).not.toHaveBeenCalled();
  });

  it("maps repository conflicts, missing targets, and outages to stable service errors", async () => {
    const input = {
      subjectId: SUBJECT_ID,
      shelterId: "DG-0001",
      clientRequestId: CLIENT_REQUEST_ID,
    };
    const dependencies = (error: CheckInRepositoryError) => ({
      authorizeSubject: vi.fn(async () => allowStaff()),
      resolveSubjectSession: vi.fn(),
      repository: {
        createPending: vi.fn(async () => {
          throw error;
        }),
      },
      actorHashSecret: HMAC_SECRET,
      now: () => NOW,
    });

    await expect(
      submitShelterCheckIn(
        input,
        { kind: "STAFF_SESSION", userId: PROFILE_ID },
        dependencies(new CheckInRepositoryError("IDEMPOTENCY_CONFLICT")),
      ),
    ).rejects.toEqual(new CheckInServiceError("IDEMPOTENCY_CONFLICT", 409));
    await expect(
      submitShelterCheckIn(
        input,
        { kind: "STAFF_SESSION", userId: PROFILE_ID },
        dependencies(new CheckInRepositoryError("NOT_FOUND")),
      ),
    ).rejects.toEqual(new CheckInServiceError("NOT_FOUND", 404));
    await expect(
      submitShelterCheckIn(
        input,
        { kind: "STAFF_SESSION", userId: PROFILE_ID },
        dependencies(new CheckInRepositoryError("WRITE_FAILED")),
      ),
    ).rejects.toEqual(new CheckInServiceError("SERVER_TEMPORARY", 503));
  });

  it("fails closed on a weak server HMAC secret before persisting an actor reference", async () => {
    const createPending = vi.fn();
    const error = await submitShelterCheckIn(
      {
        subjectId: SUBJECT_ID,
        shelterId: "DG-0001",
        clientRequestId: CLIENT_REQUEST_ID,
      },
      { kind: "STAFF_SESSION", userId: PROFILE_ID },
      {
        authorizeSubject: vi.fn(async () => allowStaff()),
        resolveSubjectSession: vi.fn(),
        repository: { createPending },
        actorHashSecret: "weak-secret",
        now: () => NOW,
      },
    ).catch((reason: unknown) => reason);

    expect(error).toEqual(new CheckInServiceError("SERVER_TEMPORARY", 503));
    expect(JSON.stringify(error)).not.toContain("weak-secret");
    expect(createPending).not.toHaveBeenCalled();
  });

  it("rejects a forged or over-posted principal instead of trusting client authorization fields", async () => {
    const authorizeSubject = vi.fn();
    const createPending = vi.fn();

    await expect(
      submitShelterCheckIn(
        {
          subjectId: SUBJECT_ID,
          shelterId: "DG-0001",
          clientRequestId: CLIENT_REQUEST_ID,
        },
        {
          kind: "STAFF_SESSION",
          userId: PROFILE_ID,
          permittedSubjectIds: [SUBJECT_ID],
          profileId: PROFILE_ID,
        } as never,
        {
          authorizeSubject,
          resolveSubjectSession: vi.fn(),
          repository: { createPending },
          actorHashSecret: HMAC_SECRET,
          now: () => NOW,
        },
      ),
    ).rejects.toEqual(new CheckInServiceError("INVALID_REQUEST", 400));
    expect(authorizeSubject).not.toHaveBeenCalled();
    expect(createPending).not.toHaveBeenCalled();
  });
});
