import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import type { MedRiskTier, MedSource, RiskLevel } from "@/lib/domain-types";
import { classifyMedication, type HeatMedicationClass } from "@/lib/medication/classify";
import {
  sanitizeModelRawText,
  type GeminiMedicationExtractionResult,
  type GeminiMedicationExtractionResult as ExtractionResult,
} from "@/lib/medication/extraction/gemini.server";
import type { MedicationExtraction } from "@/lib/medication/extraction/schema";

import {
  MedicationCandidateSchema,
  MedicationEvidenceEnrichmentInputSchema,
  MedicationManualInputSchema,
  MedicationReviewFormSchema,
  type MedicationCandidate,
} from "./schema";
import type { ValidatedMedicationUpload } from "./server-image.server";

const MANUAL_FALLBACK_MESSAGE = "AI 판독이 일시적으로 어렵습니다. 직접 입력해 주세요.";

export type MedicationSessionStatus = "NEEDS_RETAKE" | "NEEDS_CONFIRMATION" | "MANUAL_REQUIRED";

export type MedicationRiskPoint = Readonly<{ hri: number; level: RiskLevel }>;

export type MedicationConfirmationReceipt = Readonly<{
  requestId: string;
  before: MedicationRiskPoint | null;
  after: MedicationRiskPoint;
  medicationIds: readonly string[];
  transitionCreated: boolean;
}>;

export type MedicationPersistCommand = Readonly<{
  productName: string;
  itemSeq: string | null;
  ingredientName: string | null;
  heatClass: HeatMedicationClass | null;
  riskTier: MedRiskTier;
  source: MedSource;
  confidence: number | null;
}>;

export type MedicationScanRepository = Readonly<{
  createImageSession(input: {
    sessionId: string;
    subjectId: string;
    profileId: string;
    imagePath: string;
    image: ValidatedMedicationUpload;
    attemptCount: 0;
  }): Promise<void>;
  resumeImageSession(input: {
    sessionId: string;
    subjectId: string;
    profileId: string;
    image: ValidatedMedicationUpload;
  }): Promise<Readonly<{ previousAttemptCount: number }>>;
  createManualSession(input: {
    sessionId: string;
    subjectId: string;
    profileId: string;
    candidates: readonly MedicationCandidate[];
  }): Promise<void>;
  recordOutcome(input: {
    sessionId: string;
    status: MedicationSessionStatus;
    attemptCount: number;
    modelId: string | null;
    imageQuality: "GOOD" | "BLURRY" | "PARTIAL" | "UNREADABLE" | null;
    candidates: readonly MedicationCandidate[];
  }): Promise<void>;
  confirmAtomically(input: {
    requestId: string;
    subjectId: string;
    scanSessionId: string | null;
    profileId: string;
    policy: "ADD" | "REPLACE";
    medications: readonly MedicationPersistCommand[];
    confirmedAt: string;
  }): Promise<MedicationConfirmationReceipt>;
}>;

export type MedicationExtractorPort = Readonly<{
  extract(input: {
    image: {
      mimeType: "image/jpeg" | "image/png" | "image/webp";
      data: string;
    };
    previousAttemptCount: number;
  }): Promise<GeminiMedicationExtractionResult>;
}>;

export type MedicationCandidateResolverPort = Readonly<{
  resolve(extraction: MedicationExtraction): Promise<readonly MedicationCandidate[]>;
}>;

export type MedicationCandidateEnrichmentResult = Readonly<{
  outcome: "ENRICHED" | "MATCH_NOT_FOUND" | "SELECTION_REQUIRED" | "SOURCE_UNAVAILABLE";
  candidate: MedicationCandidate;
}>;

export type SelectedMedicationCandidateEnricherPort = Readonly<{
  enrich(input: {
    candidate: MedicationCandidate;
    productName: string;
    itemSeq: string;
    ingredientName: string;
  }): Promise<MedicationCandidateEnrichmentResult>;
}>;

export type MedicationEvidenceReviewRepository = Readonly<{
  loadOwnedReview(input: {
    subjectId: string;
    sessionId: string;
    profileId: string;
  }): Promise<Readonly<{
    sessionId: string;
    status: "NEEDS_CONFIRMATION" | "MANUAL_REQUIRED" | "NEEDS_RETAKE" | "COMPLETED";
    candidates: readonly MedicationCandidate[];
  }> | null>;
  replaceOwnedReviewCandidate(input: {
    subjectId: string;
    sessionId: string;
    profileId: string;
    candidateId: string;
    expectedCandidate: MedicationCandidate;
    replacementCandidate: MedicationCandidate;
  }): Promise<void>;
}>;

export type MedicationImageScanResult =
  | Readonly<{
      kind: "review";
      sessionId: string;
      candidates: readonly MedicationCandidate[];
    }>
  | Readonly<{
      kind: "retake";
      sessionId: string;
      attemptCount: number;
      userMessage: string;
    }>
  | Readonly<{
      kind: "manual";
      sessionId: string;
      userMessage: typeof MANUAL_FALLBACK_MESSAGE | string;
      safeRawText?: string;
    }>;

function imagePath(
  subjectId: string,
  sessionId: string,
  extension: string,
  attemptNumber: number,
): string {
  return `${subjectId}/${sessionId}-attempt-${attemptNumber}.${extension}`;
}

async function recordManualFallback(
  repository: MedicationScanRepository,
  sessionId: string,
  input?: Partial<{
    attemptCount: number;
    modelId: string;
    imageQuality: "GOOD" | "BLURRY" | "PARTIAL" | "UNREADABLE" | null;
  }>,
): Promise<MedicationImageScanResult> {
  await repository.recordOutcome({
    sessionId,
    status: "MANUAL_REQUIRED",
    attemptCount: input?.attemptCount ?? 1,
    modelId: input?.modelId ?? null,
    imageQuality: input?.imageQuality ?? null,
    candidates: [],
  });
  return { kind: "manual", sessionId, userMessage: MANUAL_FALLBACK_MESSAGE };
}

function outcomeMetadata(result: ExtractionResult): {
  attemptCount: number;
  modelId: string;
  imageQuality: "GOOD" | "BLURRY" | "PARTIAL" | "UNREADABLE" | null;
} {
  return {
    attemptCount: result.attemptCount,
    modelId: result.modelId,
    imageQuality: "imageQuality" in result ? result.imageQuality : null,
  };
}

export async function startMedicationImageScan(
  input: {
    subjectId: string;
    profileId: string;
    retrySessionId?: string;
    image: ValidatedMedicationUpload;
  },
  dependencies: {
    repository: MedicationScanRepository;
    extractor: MedicationExtractorPort;
    candidateResolver: MedicationCandidateResolverPort;
    sessionIdFactory?: () => string;
  },
): Promise<MedicationImageScanResult> {
  const sessionId = input.retrySessionId ?? (dependencies.sessionIdFactory ?? randomUUID)();
  let previousAttemptCount = 0;
  if (input.retrySessionId) {
    const resumed = await dependencies.repository.resumeImageSession({
      sessionId,
      subjectId: input.subjectId,
      profileId: input.profileId,
      image: input.image,
    });
    previousAttemptCount = resumed.previousAttemptCount;
  } else {
    await dependencies.repository.createImageSession({
      sessionId,
      subjectId: input.subjectId,
      profileId: input.profileId,
      imagePath: imagePath(input.subjectId, sessionId, input.image.extension, 1),
      image: input.image,
      attemptCount: 0,
    });
  }

  let result: GeminiMedicationExtractionResult;
  try {
    result = await dependencies.extractor.extract({
      image: {
        mimeType: input.image.mimeType,
        data: Buffer.from(input.image.bytes).toString("base64"),
      },
      previousAttemptCount,
    });
  } catch {
    return recordManualFallback(dependencies.repository, sessionId);
  }

  const metadata = outcomeMetadata(result);
  if (result.status === "NEEDS_CONFIRMATION") {
    let candidates: readonly MedicationCandidate[];
    try {
      candidates = MedicationCandidateSchema.array()
        .max(30)
        .parse(await dependencies.candidateResolver.resolve(result.extraction));
    } catch {
      return recordManualFallback(dependencies.repository, sessionId, metadata);
    }
    if (candidates.length === 0) {
      return recordManualFallback(dependencies.repository, sessionId, metadata);
    }
    await dependencies.repository.recordOutcome({
      sessionId,
      status: "NEEDS_CONFIRMATION",
      ...metadata,
      candidates,
    });
    return { kind: "review", sessionId, candidates };
  }

  if (result.status === "NEEDS_RETAKE") {
    await dependencies.repository.recordOutcome({
      sessionId,
      status: "NEEDS_RETAKE",
      ...metadata,
      candidates: [],
    });
    return {
      kind: "retake",
      sessionId,
      attemptCount: result.attemptCount,
      userMessage: result.userMessage,
    };
  }

  if (result.status === "REVIEW_REQUIRED") {
    await dependencies.repository.recordOutcome({
      sessionId,
      status: "MANUAL_REQUIRED",
      ...metadata,
      candidates: [],
    });
    return {
      kind: "manual",
      sessionId,
      userMessage: result.userMessage,
      safeRawText: sanitizeModelRawText(result.safeRawText),
    };
  }

  return recordManualFallback(dependencies.repository, sessionId, metadata);
}

export async function prepareManualMedicationReview(
  input: {
    subjectId: string;
    profileId: string;
    productName: string;
    itemSeq: string;
    ingredientName: string;
  },
  dependencies: {
    repository: MedicationScanRepository;
    sessionIdFactory?: () => string;
    candidateIdFactory?: () => string;
  },
): Promise<Readonly<{ sessionId: string; candidates: readonly MedicationCandidate[] }>> {
  const parsed = MedicationManualInputSchema.parse({
    subjectId: input.subjectId,
    productName: input.productName,
    itemSeq: input.itemSeq,
    ingredientName: input.ingredientName,
  });
  const sessionId = (dependencies.sessionIdFactory ?? randomUUID)();
  const classification = classifyMedication({
    ingredientNames: parsed.ingredientName ? [parsed.ingredientName] : [],
    productName: parsed.productName,
  });
  const primaryMatch = classification.matches[0];
  const candidate: MedicationCandidate = {
    candidateId: (dependencies.candidateIdFactory ?? randomUUID)(),
    productName: parsed.productName,
    itemSeq: parsed.itemSeq || null,
    manufacturerName: null,
    ingredientName: parsed.ingredientName || null,
    heatClass: primaryMatch?.heatClass ?? null,
    riskTier: primaryMatch?.tier ?? "NONE",
    confidence: null,
    source: "MANUAL",
    evidenceSource: "MANUAL",
    selected: true,
  };
  const candidates = [MedicationCandidateSchema.parse(candidate)];
  await dependencies.repository.createManualSession({
    sessionId,
    subjectId: parsed.subjectId,
    profileId: input.profileId,
    candidates,
  });
  return { sessionId, candidates };
}

export async function enrichMedicationReviewCandidate(
  input: unknown,
  dependencies: {
    repository: MedicationEvidenceReviewRepository;
    enricher: SelectedMedicationCandidateEnricherPort;
    profileId: string;
  },
): Promise<MedicationCandidateEnrichmentResult> {
  const parsed = MedicationEvidenceEnrichmentInputSchema.parse(input);
  const review = await dependencies.repository.loadOwnedReview({
    subjectId: parsed.subjectId,
    sessionId: parsed.scanSessionId,
    profileId: dependencies.profileId,
  });
  if (!review || review.status !== "NEEDS_CONFIRMATION") {
    throw new Error("MEDICATION_REVIEW_NOT_AVAILABLE");
  }

  const candidate = review.candidates.find((item) => item.candidateId === parsed.candidateId);
  if (!candidate) throw new Error("MEDICATION_REVIEW_NOT_AVAILABLE");

  const result = await dependencies.enricher.enrich({
    candidate,
    productName: parsed.productName,
    itemSeq: parsed.itemSeq,
    ingredientName: parsed.ingredientName,
  });
  await dependencies.repository.replaceOwnedReviewCandidate({
    subjectId: parsed.subjectId,
    sessionId: parsed.scanSessionId,
    profileId: dependencies.profileId,
    candidateId: parsed.candidateId,
    expectedCandidate: candidate,
    replacementCandidate: result.candidate,
  });
  return result;
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function confirmMedicationReview(
  input: unknown,
  dependencies: {
    repository: MedicationScanRepository;
    profileId: string;
    now?: () => Date;
  },
): Promise<MedicationConfirmationReceipt> {
  const parsed = MedicationReviewFormSchema.parse(input);
  const medications: MedicationPersistCommand[] = parsed.medications
    .filter((medication) => medication.selected)
    .map((medication) => ({
      productName: medication.productName,
      itemSeq: nullable(medication.itemSeq),
      ingredientName: nullable(medication.ingredientName),
      heatClass: medication.heatClass || null,
      riskTier: medication.riskTier,
      source: medication.source,
      confidence: medication.confidence,
    }));

  return dependencies.repository.confirmAtomically({
    requestId: parsed.requestId,
    subjectId: parsed.subjectId,
    scanSessionId: parsed.scanSessionId,
    profileId: dependencies.profileId,
    policy: parsed.policy,
    medications,
    confirmedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  });
}
