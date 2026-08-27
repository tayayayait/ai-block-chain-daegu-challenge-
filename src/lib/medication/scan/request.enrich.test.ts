import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError, createPublicError } from "@/lib/error-dto";

const ids = {
  subject: "00000000-0000-4000-8000-000000000001",
  profile: "00000000-0000-4000-8000-000000000002",
  session: "00000000-0000-4000-8000-000000000003",
  candidate: "00000000-0000-4000-8000-000000000004",
};

const state = vi.hoisted(() => ({
  access: { kind: "allow", profile: { id: "00000000-0000-4000-8000-000000000002" } } as
    { kind: "allow"; profile: { id: string } } | { kind: "redirect"; href: string },
  loadOwnedReview: vi.fn(),
  replaceOwnedReviewCandidate: vi.fn(),
  enrich: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({ setResponseHeader: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireSubjectAccess: vi.fn(async () => state.access),
}));
vi.mock("@/lib/auth/supabase-auth.server", () => ({
  createRequestSupabaseClient: vi.fn(() => ({})),
  getVerifiedUserId: vi.fn(async () => "00000000-0000-4000-8000-000000000099"),
}));
vi.mock("@/lib/subject-detail/repository.server", () => ({
  createSubjectAuthorizationRepository: vi.fn(() => ({})),
}));
vi.mock("@/lib/supabase/admin.server", () => ({ createAdminSupabaseClient: vi.fn(() => ({})) }));
vi.mock("./repository.server", () => ({
  createSupabaseMedicationScanRepository: vi.fn(() => ({
    loadOwnedReview: state.loadOwnedReview,
    replaceOwnedReviewCandidate: state.replaceOwnedReviewCandidate,
  })),
}));
vi.mock("./providers.server", () => ({
  createDefaultMedicationCandidateResolver: vi.fn(),
  createDefaultSelectedMedicationCandidateEnricher: vi.fn(() => ({ enrich: state.enrich })),
}));

import {
  enrichMedicationCandidateForRequest,
  loadMedicationReviewForRequest,
} from "./request.server";

const sourceCandidate = {
  candidateId: ids.candidate,
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

describe("selected medication evidence request boundary", () => {
  beforeEach(() => {
    state.access = { kind: "allow", profile: { id: ids.profile } };
    state.loadOwnedReview.mockReset().mockResolvedValue({
      sessionId: ids.session,
      status: "NEEDS_CONFIRMATION",
      candidates: [sourceCandidate],
    });
    state.replaceOwnedReviewCandidate.mockReset().mockResolvedValue(undefined);
    state.enrich.mockReset().mockResolvedValue({
      outcome: "ENRICHED",
      candidate: sourceCandidate,
    });
  });

  it("authorizes the subject before loading the creator-owned session and enriching one candidate", async () => {
    const result = await enrichMedicationCandidateForRequest({
      subjectId: ids.subject,
      scanSessionId: ids.session,
      candidateId: ids.candidate,
      productName: "라식스정",
      itemSeq: "200000001",
      ingredientName: "",
    });

    expect(result).toEqual({
      kind: "success",
      data: { outcome: "ENRICHED", candidate: sourceCandidate },
    });
    expect(state.loadOwnedReview).toHaveBeenCalledWith({
      subjectId: ids.subject,
      sessionId: ids.session,
      profileId: ids.profile,
    });
    expect(state.enrich).toHaveBeenCalledTimes(1);
  });

  it("does not touch MFDS or the scan repository when subject access redirects", async () => {
    state.access = { kind: "redirect", href: "/login?next=%2Fmedication" };

    const result = await enrichMedicationCandidateForRequest({
      subjectId: ids.subject,
      scanSessionId: ids.session,
      candidateId: ids.candidate,
      productName: "라식스정",
      itemSeq: "200000001",
      ingredientName: "",
    });

    expect(result).toEqual({ kind: "redirect", href: "/login?next=%2Fmedication" });
    expect(state.loadOwnedReview).not.toHaveBeenCalled();
    expect(state.enrich).not.toHaveBeenCalled();
  });

  it("loads the review through the same creator-owned session boundary", async () => {
    const result = await loadMedicationReviewForRequest({
      subjectId: ids.subject,
      sessionId: ids.session,
    });

    expect(result).toMatchObject({
      kind: "success",
      data: { sessionId: ids.session, status: "NEEDS_CONFIRMATION" },
    });
    expect(state.loadOwnedReview).toHaveBeenCalledWith({
      subjectId: ids.subject,
      sessionId: ids.session,
      profileId: ids.profile,
    });
  });

  it("returns a non-retryable review-changed result when candidate CAS loses a race", async () => {
    state.replaceOwnedReviewCandidate.mockRejectedValue(new AppError("REVIEW_CHANGED"));

    const result = await enrichMedicationCandidateForRequest({
      subjectId: ids.subject,
      scanSessionId: ids.session,
      candidateId: ids.candidate,
      productName: "라식스정",
      itemSeq: "200000001",
      ingredientName: "",
    });

    expect(result).toEqual({ kind: "error", error: createPublicError("REVIEW_CHANGED") });
  });
});
