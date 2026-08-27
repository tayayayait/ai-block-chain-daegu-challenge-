import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createSupabaseMedicationScanRepository,
  MedicationConfirmationReceiptSchema,
  toMedicationConfirmationRpcCommand,
} from "./repository.server";

const SUBJECT_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "00000000-0000-4000-8000-000000000002";
const SESSION_ID = "00000000-0000-4000-8000-000000000003";
const INTENT_ID = "00000000-0000-4000-8000-000000000004";
const IMAGE_PATH = `${SUBJECT_ID}/${SESSION_ID}-attempt-1.jpg`;
const NOW = new Date("2026-08-24T08:00:00.000Z");

function image() {
  return {
    bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    mimeType: "image/jpeg" as const,
    extension: "jpg" as const,
  };
}

function client(input: {
  rpc: ReturnType<typeof vi.fn>;
  upload?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
  resumable?: unknown;
}) {
  const upload = input.upload ?? vi.fn(async () => ({ data: {}, error: null }));
  const remove = input.remove ?? vi.fn(async () => ({ data: [], error: null }));
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: input.resumable ?? null, error: null })),
    insert: vi.fn(async () => ({ data: null, error: null })),
    update: vi.fn(() => query),
  };
  const value = {
    rpc: input.rpc,
    storage: { from: vi.fn(() => ({ upload, remove })) },
    from: vi.fn(() => query),
  };
  return {
    value: value as unknown as SupabaseClient,
    upload,
    remove,
    query,
  };
}

describe("Supabase medication confirmation boundary", () => {
  it("persists a cleanup intent before upload and atomically attaches the new session", async () => {
    const events: string[] = [];
    const rpc = vi.fn(async (name: string) => {
      events.push(name);
      return {
        data: name === "prepare_medication_image_cleanup" ? "PREPARED" : "APPLIED",
        error: null,
      };
    });
    const storage = client({
      rpc,
      upload: vi.fn(async () => {
        events.push("storage.upload");
        return { data: {}, error: null };
      }),
    });
    const repository = createSupabaseMedicationScanRepository(storage.value, {
      cleanupJobIdFactory: () => INTENT_ID,
      now: () => NOW,
    });

    await expect(
      repository.createImageSession({
        sessionId: SESSION_ID,
        subjectId: SUBJECT_ID,
        profileId: PROFILE_ID,
        imagePath: IMAGE_PATH,
        image: image(),
        attemptCount: 0,
      }),
    ).resolves.toBeUndefined();

    expect(events).toEqual([
      "prepare_medication_image_cleanup",
      "storage.upload",
      "attach_medication_image_session",
    ]);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "prepare_medication_image_cleanup",
      expect.objectContaining({ p_cleanup_job_id: INTENT_ID, p_image_path: IMAGE_PATH }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "attach_medication_image_session",
      expect.objectContaining({ p_cleanup_job_id: INTENT_ID, p_session_id: SESSION_ID }),
    );
    expect(storage.upload).toHaveBeenCalledWith(
      IMAGE_PATH,
      expect.any(Uint8Array),
      expect.objectContaining({ upsert: true }),
    );
  });

  it("derives the same cleanup receipt id for the same session path and bytes", async () => {
    const cleanupIds: string[] = [];
    const run = async () => {
      const rpc = vi.fn(async (name: string, parameters: Record<string, unknown>) => {
        if (name === "prepare_medication_image_cleanup") {
          cleanupIds.push(String(parameters["p_cleanup_job_id"]));
        }
        return {
          data: name === "prepare_medication_image_cleanup" ? "PREPARED" : "APPLIED",
          error: null,
        };
      });
      const storage = client({ rpc });
      const repository = createSupabaseMedicationScanRepository(storage.value, { now: () => NOW });
      await repository.createImageSession({
        sessionId: SESSION_ID,
        subjectId: SUBJECT_ID,
        profileId: PROFILE_ID,
        imagePath: IMAGE_PATH,
        image: image(),
        attemptCount: 0,
      });
    };

    await run();
    await run();

    expect(cleanupIds).toHaveLength(2);
    expect(cleanupIds[0]).toBe(cleanupIds[1]);
    expect(cleanupIds[0]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("never starts an upload when the durable PREPARED intent cannot be recorded", async () => {
    const storage = client({
      rpc: vi.fn(async () => ({ data: null, error: { message: "private database detail" } })),
    });
    const repository = createSupabaseMedicationScanRepository(storage.value, {
      cleanupJobIdFactory: () => INTENT_ID,
      now: () => NOW,
    });

    await expect(
      repository.createImageSession({
        sessionId: SESSION_ID,
        subjectId: SUBJECT_ID,
        profileId: PROFILE_ID,
        imagePath: IMAGE_PATH,
        image: image(),
        attemptCount: 0,
      }),
    ).rejects.toThrow("MEDICATION_REPOSITORY_OPERATION_FAILED");
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("leaves the PREPARED cleanup intent durable when the attach RPC fails", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: "PREPARED", error: null })
      .mockResolvedValueOnce({ data: null, error: { message: `raw:${IMAGE_PATH}` } });
    const storage = client({ rpc });
    const repository = createSupabaseMedicationScanRepository(storage.value, {
      cleanupJobIdFactory: () => INTENT_ID,
      now: () => NOW,
    });

    let message = "";
    try {
      await repository.createImageSession({
        sessionId: SESSION_ID,
        subjectId: SUBJECT_ID,
        profileId: PROFILE_ID,
        imagePath: IMAGE_PATH,
        image: image(),
        attemptCount: 0,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("MEDICATION_REPOSITORY_OPERATION_FAILED");
    expect(message).not.toContain(IMAGE_PATH);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("replaces a retake through one optimistic RPC and never deletes either path inline", async () => {
    const nextIntentId = "00000000-0000-4000-8000-000000000005";
    const previousPath = IMAGE_PATH;
    const nextPath = `${SUBJECT_ID}/${SESSION_ID}-attempt-2.webp`;
    const rpc = vi.fn(async (name: string) => ({
      data: name === "replace_medication_image_session" ? 1 : "PREPARED",
      error: null,
    }));
    const storage = client({
      rpc,
      resumable: {
        id: SESSION_ID,
        subject_id: SUBJECT_ID,
        image_path: previousPath,
        status: "NEEDS_RETAKE",
        attempt_count: 1,
      },
    });
    const repository = createSupabaseMedicationScanRepository(storage.value, {
      cleanupJobIdFactory: () => nextIntentId,
      now: () => NOW,
    });

    await expect(
      repository.resumeImageSession({
        sessionId: SESSION_ID,
        subjectId: SUBJECT_ID,
        profileId: PROFILE_ID,
        image: { ...image(), mimeType: "image/webp", extension: "webp" },
      }),
    ).resolves.toEqual({ previousAttemptCount: 1 });

    expect(storage.upload).toHaveBeenCalledWith(
      nextPath,
      expect.any(Uint8Array),
      expect.anything(),
    );
    expect(rpc).toHaveBeenCalledWith(
      "replace_medication_image_session",
      expect.objectContaining({
        p_cleanup_job_id: nextIntentId,
        p_expected_attempt_count: 1,
        p_new_image_path: nextPath,
      }),
    );
    expect(storage.remove).not.toHaveBeenCalled();
    expect(storage.query.update).not.toHaveBeenCalled();
  });

  it("recovers a response-lost retake that is already atomically attached", async () => {
    const nextIntentId = "00000000-0000-4000-8000-000000000005";
    const nextPath = `${SUBJECT_ID}/${SESSION_ID}-attempt-2.webp`;
    const rpc = vi.fn(async (name: string) => ({
      data: name === "replace_medication_image_session" ? 1 : "IDEMPOTENT",
      error: null,
    }));
    const storage = client({
      rpc,
      resumable: {
        id: SESSION_ID,
        subject_id: SUBJECT_ID,
        image_path: nextPath,
        status: "UPLOADED",
        attempt_count: 1,
      },
    });
    const repository = createSupabaseMedicationScanRepository(storage.value, {
      cleanupJobIdFactory: () => nextIntentId,
      now: () => NOW,
    });

    await expect(
      repository.resumeImageSession({
        sessionId: SESSION_ID,
        subjectId: SUBJECT_ID,
        profileId: PROFILE_ID,
        image: { ...image(), mimeType: "image/webp", extension: "webp" },
      }),
    ).resolves.toEqual({ previousAttemptCount: 1 });

    expect(storage.upload).toHaveBeenCalledWith(
      nextPath,
      expect.any(Uint8Array),
      expect.objectContaining({ upsert: true }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "replace_medication_image_session",
      expect.objectContaining({
        p_cleanup_job_id: nextIntentId,
        p_expected_attempt_count: 1,
        p_new_image_path: nextPath,
      }),
    );
  });

  it("maps only normalized fields to the one atomic RPC command", () => {
    const command = toMedicationConfirmationRpcCommand({
      requestId: "00000000-0000-4000-8000-000000000001",
      subjectId: "00000000-0000-4000-8000-000000000002",
      scanSessionId: "00000000-0000-4000-8000-000000000003",
      profileId: "00000000-0000-4000-8000-000000000004",
      policy: "ADD",
      confirmedAt: "2026-08-23T10:00:00.000Z",
      medications: [
        {
          productName: "라식스정",
          itemSeq: "200000001",
          ingredientName: "푸로세미드",
          heatClass: "이뇨제",
          riskTier: "HIGH",
          source: "AI_AUTO",
          confidence: 0.9,
        },
      ],
    });

    expect(command).toEqual({
      request_id: "00000000-0000-4000-8000-000000000001",
      subject_id: "00000000-0000-4000-8000-000000000002",
      scan_session_id: "00000000-0000-4000-8000-000000000003",
      profile_id: "00000000-0000-4000-8000-000000000004",
      policy: "ADD",
      confirmed_at: "2026-08-23T10:00:00.000Z",
      medications: [
        {
          product_name: "라식스정",
          item_seq: "200000001",
          ingredient_name: "푸로세미드",
          heat_class: "이뇨제",
          risk_tier: "HIGH",
          source: "AI_AUTO",
          confidence: 0.9,
        },
      ],
    });
    expect(JSON.stringify(command)).not.toMatch(/image|api.?key|secret|manufacturer/iu);
  });

  it("rejects malformed RPC receipts instead of trusting provider data", () => {
    expect(
      MedicationConfirmationReceiptSchema.safeParse({
        request_id: "00000000-0000-4000-8000-000000000001",
        before: null,
        after: { hri: 101, level: "L4" },
        medication_ids: [],
        transition_created: false,
      }).success,
    ).toBe(false);
  });

  it("loads a review only through the subject, session, and creator ownership tuple", async () => {
    const candidate = {
      candidateId: "00000000-0000-4000-8000-000000000010",
      productName: "라식스정",
      itemSeq: "200000001",
      manufacturerName: null,
      ingredientName: null,
      heatClass: null,
      riskTier: "NONE" as const,
      confidence: null,
      source: "MANUAL" as const,
      evidenceSource: "MANUAL" as const,
      selected: true,
    };
    const storage = client({
      rpc: vi.fn(),
      resumable: {
        id: SESSION_ID,
        subject_id: SUBJECT_ID,
        status: "NEEDS_CONFIRMATION",
        candidate_payload: [candidate],
      },
    });
    const repository = createSupabaseMedicationScanRepository(storage.value);

    await expect(
      repository.loadOwnedReview({
        subjectId: SUBJECT_ID,
        sessionId: SESSION_ID,
        profileId: PROFILE_ID,
      }),
    ).resolves.toEqual({
      sessionId: SESSION_ID,
      status: "NEEDS_CONFIRMATION",
      candidates: [candidate],
    });
    expect(storage.query.eq).toHaveBeenCalledWith("id", SESSION_ID);
    expect(storage.query.eq).toHaveBeenCalledWith("subject_id", SUBJECT_ID);
    expect(storage.query.eq).toHaveBeenCalledWith("created_by", PROFILE_ID);
  });

  it("atomically replaces only one unchanged candidate through the service-role RPC", async () => {
    const candidate = {
      candidateId: "00000000-0000-4000-8000-000000000010",
      productName: "라식스정",
      itemSeq: "200000001",
      manufacturerName: "테스트제약",
      ingredientName: "푸로세미드",
      heatClass: "이뇨제" as const,
      riskTier: "HIGH" as const,
      confidence: null,
      source: "MANUAL" as const,
      evidenceSource: "MANUAL" as const,
      selected: true,
    };
    const replacementCandidate = {
      ...candidate,
      productName: "라식스정 실제 품목",
      evidenceSource: "GEMINI_MFDS" as const,
    };
    const rpc = vi.fn(async () => ({ data: "APPLIED", error: null }));
    const storage = client({ rpc });
    const repository = createSupabaseMedicationScanRepository(storage.value);

    await expect(
      repository.replaceOwnedReviewCandidate({
        subjectId: SUBJECT_ID,
        sessionId: SESSION_ID,
        profileId: PROFILE_ID,
        candidateId: candidate.candidateId,
        expectedCandidate: candidate,
        replacementCandidate,
      }),
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith("replace_medication_review_candidate", {
      p_command: {
        subject_id: SUBJECT_ID,
        scan_session_id: SESSION_ID,
        profile_id: PROFILE_ID,
        candidate_id: candidate.candidateId,
        expected_candidate: candidate,
        replacement_candidate: replacementCandidate,
      },
    });
    expect(storage.query.update).not.toHaveBeenCalled();
  });

  it("preserves the serializable conflict as a stable review-changed error", async () => {
    const candidate = {
      candidateId: "00000000-0000-4000-8000-000000000010",
      productName: "라식스정",
      itemSeq: null,
      manufacturerName: null,
      ingredientName: null,
      heatClass: null,
      riskTier: "NONE" as const,
      confidence: null,
      source: "MANUAL" as const,
      evidenceSource: "MANUAL" as const,
      selected: true,
    };
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "40001", message: "must stay private" },
    }));
    const repository = createSupabaseMedicationScanRepository(client({ rpc }).value);

    await expect(
      repository.replaceOwnedReviewCandidate({
        subjectId: SUBJECT_ID,
        sessionId: SESSION_ID,
        profileId: PROFILE_ID,
        candidateId: candidate.candidateId,
        expectedCandidate: candidate,
        replacementCandidate: candidate,
      }),
    ).rejects.toMatchObject({ code: "REVIEW_CHANGED" });
  });
});
