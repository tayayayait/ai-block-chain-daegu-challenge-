import { describe, expect, it, vi } from "vitest";

import {
  confirmMedicationReview,
  enrichMedicationReviewCandidate,
  prepareManualMedicationReview,
  startMedicationImageScan,
  type MedicationEvidenceReviewRepository,
  type MedicationScanRepository,
} from "./service";

const subjectId = "00000000-0000-4000-8000-000000000001";
const profileId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";

function repository(): MedicationScanRepository {
  return {
    createImageSession: vi.fn(async () => undefined),
    resumeImageSession: vi.fn(async () => ({ previousAttemptCount: 1 })),
    createManualSession: vi.fn(async () => undefined),
    recordOutcome: vi.fn(async () => undefined),
    confirmAtomically: vi.fn(async () => ({
      requestId,
      before: { hri: 50, level: "L2" as const },
      after: { hri: 62, level: "L3" as const },
      medicationIds: ["00000000-0000-4000-8000-000000000010"],
      transitionCreated: true,
    })),
  };
}

describe("medication scan use cases", () => {
  it("records model/quality/attempt and candidates but never saves medication before review", async () => {
    const store = repository();
    const result = await startMedicationImageScan(
      {
        subjectId,
        profileId,
        image: {
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
          mimeType: "image/jpeg",
          extension: "jpg",
        },
      },
      {
        repository: store,
        sessionIdFactory: () => sessionId,
        extractor: {
          extract: vi.fn(async () => ({
            status: "NEEDS_CONFIRMATION" as const,
            attemptCount: 1,
            modelId: "gemini-test",
            canPersist: false as const,
            imageQuality: "GOOD" as const,
            extraction: {
              imageQuality: "GOOD" as const,
              items: [{ rawText: "온중정", productName: "온중정", confidence: 0.92 }],
            },
            userMessage: null,
          })),
        },
        candidateResolver: {
          resolve: vi.fn(async () => [
            {
              candidateId: "00000000-0000-4000-8000-000000000005",
              productName: "온중정",
              itemSeq: "200000001",
              manufacturerName: "온중제약",
              ingredientName: "푸로세미드",
              heatClass: "이뇨제" as const,
              riskTier: "HIGH" as const,
              confidence: 0.92,
              source: "AI_AUTO" as const,
              evidenceSource: "GEMINI_MFDS" as const,
              selected: true,
            },
          ]),
        },
      },
    );

    expect(result).toMatchObject({ kind: "review", sessionId });
    expect(store.createImageSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, subjectId, profileId, attemptCount: 0 }),
    );
    expect(store.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        status: "NEEDS_CONFIRMATION",
        attemptCount: 1,
        modelId: "gemini-test",
        imageQuality: "GOOD",
      }),
    );
    expect(store.confirmAtomically).not.toHaveBeenCalled();
  });

  it("falls back to manual entry without leaking a provider failure", async () => {
    const store = repository();
    const result = await startMedicationImageScan(
      {
        subjectId,
        profileId,
        image: {
          bytes: new Uint8Array([0xff, 0xd8, 0xff]),
          mimeType: "image/jpeg",
          extension: "jpg",
        },
      },
      {
        repository: store,
        sessionIdFactory: () => sessionId,
        extractor: {
          extract: vi.fn(async () => {
            throw new Error("provider raw secret response");
          }),
        },
        candidateResolver: { resolve: vi.fn() },
      },
    );

    expect(result).toEqual({
      kind: "manual",
      sessionId,
      userMessage: "AI 판독이 일시적으로 어렵습니다. 직접 입력해 주세요.",
    });
    expect(JSON.stringify(result)).not.toContain("provider raw secret");
  });

  it("returns only editable sanitized review text without persisting model raw output", async () => {
    const store = repository();
    const result = await startMedicationImageScan(
      {
        subjectId,
        profileId,
        image: {
          bytes: new Uint8Array([0xff, 0xd8, 0xff]),
          mimeType: "image/jpeg",
          extension: "jpg",
        },
      },
      {
        repository: store,
        sessionIdFactory: () => sessionId,
        extractor: {
          extract: vi.fn(async () => ({
            status: "REVIEW_REQUIRED" as const,
            attemptCount: 1,
            modelId: "gemini-test",
            canPersist: false as const,
            errorCode: "GEMINI_SCHEMA_INVALID" as const,
            safeRawText:
              "제품 후보: 검토정\u0000 apiKey=TOP_SECRET https://provider.test/private " +
              "A".repeat(120),
            userMessage: "AI 판독 결과를 확인하고 수정한 뒤 확정해 주세요." as const,
          })),
        },
        candidateResolver: { resolve: vi.fn() },
      },
    );

    expect(result).toMatchObject({
      kind: "manual",
      sessionId,
      userMessage: "AI 판독 결과를 확인하고 수정한 뒤 확정해 주세요.",
      safeRawText: expect.stringContaining("제품 후보: 검토정"),
    });
    expect(JSON.stringify(result)).not.toMatch(/TOP_SECRET|provider\.test|A{80}|\\u0000/);
    expect(store.recordOutcome).toHaveBeenCalledWith({
      sessionId,
      status: "MANUAL_REQUIRED",
      attemptCount: 1,
      modelId: "gemini-test",
      imageQuality: null,
      candidates: [],
    });
    expect(JSON.stringify(vi.mocked(store.recordOutcome).mock.calls)).not.toContain("검토정");
  });

  it("resumes the same session and passes its trusted attempt count to a retake", async () => {
    const store = repository();
    const extract = vi.fn(async () => ({
      status: "NEEDS_RETAKE" as const,
      attemptCount: 2,
      modelId: "gemini-test",
      canPersist: false as const,
      imageQuality: "BLURRY" as const,
      userMessage: "사진이 흔들렸습니다.",
    }));

    const result = await startMedicationImageScan(
      {
        subjectId,
        profileId,
        retrySessionId: sessionId,
        image: {
          bytes: new Uint8Array([0xff, 0xd8, 0xff]),
          mimeType: "image/jpeg",
          extension: "jpg",
        },
      },
      {
        repository: store,
        extractor: { extract },
        candidateResolver: { resolve: vi.fn() },
      },
    );

    expect(store.resumeImageSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, subjectId }),
    );
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ previousAttemptCount: 1 }));
    expect(result).toMatchObject({ kind: "retake", sessionId, attemptCount: 2 });
  });

  it("creates a classified manual review session without an image", async () => {
    const store = repository();
    const result = await prepareManualMedicationReview(
      {
        subjectId,
        profileId,
        productName: "라식스정",
        itemSeq: "",
        ingredientName: "푸로세미드",
      },
      { repository: store, sessionIdFactory: () => sessionId },
    );

    expect(result.candidates[0]).toMatchObject({
      productName: "라식스정",
      riskTier: "HIGH",
      heatClass: "이뇨제",
      source: "MANUAL",
    });
    expect(store.createManualSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, subjectId, profileId }),
    );
  });

  it("filters deselected candidates and delegates one atomic idempotent confirmation", async () => {
    const store = repository();
    const result = await confirmMedicationReview(
      {
        requestId,
        subjectId,
        scanSessionId: sessionId,
        policy: "REPLACE",
        confirmed: true,
        medications: [
          {
            candidateId: "00000000-0000-4000-8000-000000000005",
            productName: "온중정",
            itemSeq: "200000001",
            manufacturerName: "온중제약",
            ingredientName: "푸로세미드",
            heatClass: "이뇨제",
            riskTier: "HIGH",
            confidence: 0.92,
            source: "AI_AUTO",
            evidenceSource: "GEMINI_MFDS",
            selected: true,
          },
          {
            candidateId: "00000000-0000-4000-8000-000000000006",
            productName: "제외정",
            itemSeq: "",
            manufacturerName: "",
            ingredientName: "",
            heatClass: "",
            riskTier: "NONE",
            confidence: null,
            source: "MANUAL",
            evidenceSource: "MANUAL",
            selected: false,
          },
        ],
      },
      { repository: store, profileId },
    );

    expect(result.after).toEqual({ hri: 62, level: "L3" });
    expect(store.confirmAtomically).toHaveBeenCalledTimes(1);
    expect(store.confirmAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
        profileId,
        policy: "REPLACE",
        medications: [expect.objectContaining({ productName: "온중정" })],
      }),
    );
  });

  it("enriches only the owned review candidate and persists the bounded evidence", async () => {
    const otherCandidateId = "00000000-0000-4000-8000-000000000006";
    const sourceCandidate = {
      candidateId: "00000000-0000-4000-8000-000000000005",
      productName: "라식스정 후보",
      itemSeq: "200000001",
      manufacturerName: null,
      ingredientName: null,
      heatClass: null,
      riskTier: "NONE" as const,
      confidence: 0.7,
      source: "AI_CONFIRMED" as const,
      evidenceSource: "GEMINI_MFDS" as const,
      selected: false,
    };
    const otherCandidate = {
      ...sourceCandidate,
      candidateId: otherCandidateId,
      productName: "그대로 둘 후보",
      itemSeq: "200000002",
    };
    const enrichedCandidate = {
      ...sourceCandidate,
      productName: "라식스정",
      ingredientName: "푸로세미드",
      heatClass: "이뇨제" as const,
      riskTier: "HIGH" as const,
      selected: true,
    };
    const replaceOwnedReviewCandidate = vi.fn(async () => undefined);
    const evidenceRepository: MedicationEvidenceReviewRepository = {
      loadOwnedReview: vi.fn(async () => ({
        sessionId,
        status: "NEEDS_CONFIRMATION" as const,
        candidates: [sourceCandidate, otherCandidate],
      })),
      replaceOwnedReviewCandidate,
    };
    const enrich = vi.fn(async () => ({
      outcome: "ENRICHED" as const,
      candidate: enrichedCandidate,
    }));

    const result = await enrichMedicationReviewCandidate(
      {
        subjectId,
        scanSessionId: sessionId,
        candidateId: sourceCandidate.candidateId,
        productName: "사용자가 검토한 라식스정",
        itemSeq: "200000001",
        ingredientName: "",
      },
      { repository: evidenceRepository, enricher: { enrich }, profileId },
    );

    expect(evidenceRepository.loadOwnedReview).toHaveBeenCalledWith({
      subjectId,
      sessionId,
      profileId,
    });
    expect(enrich).toHaveBeenCalledWith({
      candidate: sourceCandidate,
      productName: "사용자가 검토한 라식스정",
      itemSeq: "200000001",
      ingredientName: "",
    });
    expect(replaceOwnedReviewCandidate).toHaveBeenCalledWith({
      subjectId,
      sessionId,
      profileId,
      candidateId: sourceCandidate.candidateId,
      expectedCandidate: sourceCandidate,
      replacementCandidate: enrichedCandidate,
    });
    expect(result).toEqual({ outcome: "ENRICHED", candidate: enrichedCandidate });
  });

  it("rejects evidence enrichment when the session is not owned or is completed", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000005";
    const baseInput = {
      subjectId,
      scanSessionId: sessionId,
      candidateId,
      productName: "라식스정",
      itemSeq: "200000001",
      ingredientName: "",
    };
    const missingRepository: MedicationEvidenceReviewRepository = {
      loadOwnedReview: vi.fn(async () => null),
      replaceOwnedReviewCandidate: vi.fn(),
    };
    const enricher = { enrich: vi.fn() };

    await expect(
      enrichMedicationReviewCandidate(baseInput, {
        repository: missingRepository,
        enricher,
        profileId,
      }),
    ).rejects.toThrow("MEDICATION_REVIEW_NOT_AVAILABLE");
    expect(enricher.enrich).not.toHaveBeenCalled();

    const completedRepository: MedicationEvidenceReviewRepository = {
      loadOwnedReview: vi.fn(async () => ({
        sessionId,
        status: "COMPLETED" as const,
        candidates: [],
      })),
      replaceOwnedReviewCandidate: vi.fn(),
    };
    await expect(
      enrichMedicationReviewCandidate(baseInput, {
        repository: completedRepository,
        enricher,
        profileId,
      }),
    ).rejects.toThrow("MEDICATION_REVIEW_NOT_AVAILABLE");
    expect(enricher.enrich).not.toHaveBeenCalled();
  });
});
