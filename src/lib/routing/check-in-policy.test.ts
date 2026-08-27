import { describe, expect, it, vi } from "vitest";

import {
  authorizeCheckIn,
  checkInMitigationStatus,
  createPendingShelterCheckIn,
} from "./check-in-policy";

const subjectId = "00000000-0000-4000-8000-000000000001";

describe("shelter check-in policy", () => {
  it("allows staff only after subject authorization", () => {
    expect(
      authorizeCheckIn(subjectId, {
        kind: "STAFF",
        profileId: "00000000-0000-4000-8000-000000000002",
        permittedSubjectIds: [subjectId],
      }),
    ).toMatchObject({ allowed: true, actorScope: "CAREGIVER" });
    expect(
      authorizeCheckIn(subjectId, {
        kind: "STAFF",
        profileId: "00000000-0000-4000-8000-000000000002",
        permittedSubjectIds: [],
      }),
    ).toEqual({ allowed: false, reason: "SUBJECT_FORBIDDEN" });
  });

  it("allows only a live session scoped to the same subject and rejects public users", () => {
    expect(
      authorizeCheckIn(subjectId, {
        kind: "SUBJECT_SESSION",
        sessionId: "00000000-0000-4000-8000-000000000003",
        subjectId,
        expiresAt: new Date("2026-08-24T00:00:00Z"),
        now: new Date("2026-08-23T00:00:00Z"),
      }),
    ).toMatchObject({ allowed: true, actorScope: "SUBJECT_SCOPED" });
    expect(authorizeCheckIn(subjectId, { kind: "PUBLIC" })).toEqual({
      allowed: false,
      reason: "AUTHENTICATION_REQUIRED",
    });
  });

  it("persists PENDING and never applies C=6 before VERIFIED is seen by a later recompute", async () => {
    const insertPending = vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000004",
      attestationState: "PENDING" as const,
      checkedInAt: new Date("2026-08-23T04:00:00Z"),
    });
    const result = await createPendingShelterCheckIn(
      {
        subjectId,
        shelterId: "SHELTER-001",
        checkedInAt: new Date("2026-08-23T04:00:00Z"),
        clientRequestId: "00000000-0000-4000-8000-000000000005",
        actor: {
          kind: "STAFF",
          profileId: "00000000-0000-4000-8000-000000000002",
          permittedSubjectIds: [subjectId],
        },
      },
      { insertPending, actorHash: async () => "a".repeat(64) },
    );

    expect(result.displayStatus).toBe("RECORDING_PENDING");
    expect(insertPending).toHaveBeenCalledWith(
      expect.objectContaining({ attestationState: "PENDING" }),
    );
    expect(
      checkInMitigationStatus({
        attestationState: "PENDING",
        checkedInAt: new Date("2026-08-23T04:00:00Z"),
        computedAt: new Date("2026-08-23T04:30:00Z"),
      }),
    ).toEqual({ displayStatus: "RECORDING_PENDING", contribution: 0 });
    expect(
      checkInMitigationStatus({
        attestationState: "VERIFIED",
        checkedInAt: new Date("2026-08-23T04:00:00Z"),
        verifiedAt: new Date("2026-08-23T04:40:00Z"),
        computedAt: new Date("2026-08-23T04:30:00Z"),
      }),
    ).toEqual({ displayStatus: "VERIFIED_AWAITING_RECOMPUTE", contribution: 0 });
    expect(
      checkInMitigationStatus({
        attestationState: "VERIFIED",
        checkedInAt: new Date("2026-08-23T04:00:00Z"),
        verifiedAt: new Date("2026-08-23T04:40:00Z"),
        computedAt: new Date("2026-08-23T05:00:00Z"),
      }),
    ).toEqual({ displayStatus: "MITIGATION_APPLIED", contribution: 6 });
  });
});
