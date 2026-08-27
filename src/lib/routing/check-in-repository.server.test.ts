import { describe, expect, it, vi } from "vitest";

import {
  CheckInRepositoryError,
  createSupabaseCheckInRepository,
  type CheckInRpcClient,
} from "./check-in-repository.server";

const SUBJECT_ID = "10000000-0000-4000-8000-000000000001";
const CHECK_IN_ID = "20000000-0000-4000-8000-000000000001";
const CLIENT_REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const CHECKED_IN_AT = new Date("2026-08-24T04:00:00.000Z");

describe("Supabase shelter check-in repository", () => {
  it("calls only the service-role pending check-in RPC and maps its strict response", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          checkin_id: CHECK_IN_ID,
          attestation_state: "PENDING",
          attestation_job_state: "PENDING",
        },
      ],
      error: null,
    }));
    const repository = createSupabaseCheckInRepository({ rpc } as CheckInRpcClient);

    const result = await repository.createPending({
      subjectId: SUBJECT_ID,
      shelterId: "DG-0001",
      checkedInAt: CHECKED_IN_AT,
      clientRequestId: CLIENT_REQUEST_ID,
      actorScope: "CAREGIVER",
      actorRefHash: "a".repeat(64),
      attestationState: "PENDING",
    });

    expect(rpc).toHaveBeenCalledWith("create_pending_shelter_checkin", {
      p_subject_id: SUBJECT_ID,
      p_shelter_id: "DG-0001",
      p_checked_in_at: CHECKED_IN_AT.toISOString(),
      p_actor_scope: "CAREGIVER",
      p_actor_ref_hash: "a".repeat(64),
      p_client_request_id: CLIENT_REQUEST_ID,
    });
    expect(result).toEqual({
      id: CHECK_IN_ID,
      attestationState: "PENDING",
      checkedInAt: CHECKED_IN_AT,
      jobState: "PENDING",
    });
  });

  it("rejects a non-v4 idempotency key and over-posted input before calling Supabase", async () => {
    const rpc = vi.fn();
    const repository = createSupabaseCheckInRepository({ rpc } as CheckInRpcClient);

    await expect(
      repository.createPending({
        subjectId: SUBJECT_ID,
        shelterId: "DG-0001",
        checkedInAt: CHECKED_IN_AT,
        clientRequestId: "30000000-0000-1000-8000-000000000001",
        actorScope: "CAREGIVER",
        actorRefHash: "a".repeat(64),
        attestationState: "PENDING",
        actorUserId: "must-never-be-persisted",
      } as never),
    ).rejects.toEqual(new CheckInRepositoryError("INVALID_REQUEST"));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps database failures to stable codes without exposing provider diagnostics", async () => {
    const secret = "SERVICE_ROLE_AND_RAW_DATABASE_MESSAGE";
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "23505", message: secret },
    }));
    const repository = createSupabaseCheckInRepository({ rpc } as CheckInRpcClient);

    const error = await repository
      .createPending({
        subjectId: SUBJECT_ID,
        shelterId: "DG-0001",
        checkedInAt: CHECKED_IN_AT,
        clientRequestId: CLIENT_REQUEST_ID,
        actorScope: "CAREGIVER",
        actorRefHash: "a".repeat(64),
        attestationState: "PENDING",
      })
      .catch((reason: unknown) => reason);

    expect(error).toEqual(new CheckInRepositoryError("IDEMPOTENCY_CONFLICT"));
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it("fails closed when the RPC returns an over-posted or non-pending row", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          checkin_id: CHECK_IN_ID,
          attestation_state: "VERIFIED",
          attestation_job_state: "VERIFIED",
          actor_ref_hash: "private-server-value",
        },
      ],
      error: null,
    }));
    const repository = createSupabaseCheckInRepository({ rpc } as CheckInRpcClient);

    await expect(
      repository.createPending({
        subjectId: SUBJECT_ID,
        shelterId: "DG-0001",
        checkedInAt: CHECKED_IN_AT,
        clientRequestId: CLIENT_REQUEST_ID,
        actorScope: "SUBJECT_SCOPED",
        actorRefHash: "b".repeat(64),
        attestationState: "PENDING",
      }),
    ).rejects.toEqual(new CheckInRepositoryError("INVALID_RESPONSE"));
  });

  it("rejects a terminal attestation job paired with a still-pending check-in", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          checkin_id: CHECK_IN_ID,
          attestation_state: "PENDING",
          attestation_job_state: "VERIFIED",
        },
      ],
      error: null,
    }));
    const repository = createSupabaseCheckInRepository({ rpc } as CheckInRpcClient);

    await expect(
      repository.createPending({
        subjectId: SUBJECT_ID,
        shelterId: "DG-0001",
        checkedInAt: CHECKED_IN_AT,
        clientRequestId: CLIENT_REQUEST_ID,
        actorScope: "CAREGIVER",
        actorRefHash: "c".repeat(64),
        attestationState: "PENDING",
      }),
    ).rejects.toEqual(new CheckInRepositoryError("INVALID_RESPONSE"));
  });
});
