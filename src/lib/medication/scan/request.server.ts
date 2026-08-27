import "@tanstack/react-start/server-only";

import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSubjectAccess } from "@/lib/auth/guards";
import { createRequestSupabaseClient, getVerifiedUserId } from "@/lib/auth/supabase-auth.server";
import { AppError, createPublicError, type PublicErrorDto } from "@/lib/error-dto";
import { createDefaultGeminiMedicationExtractor } from "@/lib/medication/extraction/gemini.server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";
import { createSubjectAuthorizationRepository } from "@/lib/subject-detail/repository.server";

import {
  createDefaultMedicationCandidateResolver,
  createDefaultSelectedMedicationCandidateEnricher,
} from "./providers.server";
import { createSupabaseMedicationScanRepository } from "./repository.server";
import {
  MedicationEvidenceEnrichmentInputSchema,
  MedicationManualInputSchema,
  MedicationReviewFormSchema,
} from "./schema";
import {
  confirmMedicationReview,
  enrichMedicationReviewCandidate,
  prepareManualMedicationReview,
  startMedicationImageScan,
  type MedicationConfirmationReceipt,
  type MedicationImageScanResult,
} from "./service";
import { validateMedicationUpload } from "./server-image.server";

const UuidSchema = z.string().uuid();

export type MedicationRequestResult<T> =
  | Readonly<{ kind: "success"; data: T }>
  | Readonly<{ kind: "redirect"; href: string }>
  | Readonly<{ kind: "error"; error: PublicErrorDto }>;

type MedicationRequestAccess =
  | Readonly<{ kind: "allow"; profileId: string }>
  | Exclude<MedicationRequestResult<never>, { kind: "success" }>;

function privateNoStore(): void {
  setResponseHeader("cache-control", "private, no-cache, no-store, must-revalidate, max-age=0");
  setResponseHeader("expires", "0");
  setResponseHeader("pragma", "no-cache");
}

async function authorize(subjectId: string): Promise<MedicationRequestAccess> {
  privateNoStore();
  try {
    const client = createRequestSupabaseClient();
    const userId = await getVerifiedUserId(client);
    const access = await requireSubjectAccess(
      {
        userId,
        subjectId,
        nextPath: `/medication/${encodeURIComponent(subjectId)}`,
      },
      createSubjectAuthorizationRepository(client),
    );
    if (access.kind !== "allow") return access;
    return { kind: "allow", profileId: access.profile.id };
  } catch {
    return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
  }
}

function internalError<T>(): MedicationRequestResult<T> {
  return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
}

function invalidRequest<T>(): MedicationRequestResult<T> {
  return { kind: "error", error: createPublicError("INVALID_REQUEST") };
}

export async function captureMedicationForRequest(input: {
  subjectId: string;
  retrySessionId?: string;
  image: File;
}): Promise<MedicationRequestResult<MedicationImageScanResult>> {
  const subjectId = UuidSchema.safeParse(input.subjectId);
  if (!subjectId.success) return invalidRequest();
  const retrySessionId = input.retrySessionId ? UuidSchema.safeParse(input.retrySessionId) : null;
  if (retrySessionId && !retrySessionId.success) return invalidRequest();
  const access = await authorize(subjectId.data);
  if (access.kind !== "allow") return access;

  try {
    const repository = createSupabaseMedicationScanRepository(createAdminSupabaseClient());
    const image = await validateMedicationUpload(input.image);
    const result = await startMedicationImageScan(
      {
        subjectId: subjectId.data,
        profileId: access.profileId,
        ...(retrySessionId?.success ? { retrySessionId: retrySessionId.data } : {}),
        image,
      },
      {
        repository,
        extractor: {
          extract: (request) => createDefaultGeminiMedicationExtractor().extract(request),
        },
        candidateResolver: {
          resolve: (extraction) => createDefaultMedicationCandidateResolver().resolve(extraction),
        },
      },
    );
    return { kind: "success", data: result };
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "IMAGE_MISSING",
        "IMAGE_EMPTY",
        "IMAGE_TOO_LARGE",
        "IMAGE_TYPE_UNSUPPORTED",
        "IMAGE_SIGNATURE_INVALID",
      ].includes(error.message)
    ) {
      return invalidRequest();
    }
    return internalError();
  }
}

export async function manualMedicationForRequest(
  input: unknown,
): Promise<MedicationRequestResult<Awaited<ReturnType<typeof prepareManualMedicationReview>>>> {
  const parsed = MedicationManualInputSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const access = await authorize(parsed.data.subjectId);
  if (access.kind !== "allow") return access;

  try {
    const result = await prepareManualMedicationReview(
      { ...parsed.data, profileId: access.profileId },
      {
        repository: createSupabaseMedicationScanRepository(createAdminSupabaseClient()),
      },
    );
    return { kind: "success", data: result };
  } catch {
    return internalError();
  }
}

export async function enrichMedicationCandidateForRequest(
  input: unknown,
): Promise<MedicationRequestResult<Awaited<ReturnType<typeof enrichMedicationReviewCandidate>>>> {
  const parsed = MedicationEvidenceEnrichmentInputSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const access = await authorize(parsed.data.subjectId);
  if (access.kind !== "allow") return access;

  try {
    const result = await enrichMedicationReviewCandidate(parsed.data, {
      repository: createSupabaseMedicationScanRepository(createAdminSupabaseClient()),
      enricher: createDefaultSelectedMedicationCandidateEnricher(),
      profileId: access.profileId,
    });
    return { kind: "success", data: result };
  } catch (error) {
    if (error instanceof AppError && error.code === "REVIEW_CHANGED") {
      return { kind: "error", error: createPublicError("REVIEW_CHANGED") };
    }
    return internalError();
  }
}

export async function confirmMedicationForRequest(
  input: unknown,
): Promise<MedicationRequestResult<MedicationConfirmationReceipt>> {
  const parsed = MedicationReviewFormSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const access = await authorize(parsed.data.subjectId);
  if (access.kind !== "allow") return access;

  try {
    const receipt = await confirmMedicationReview(parsed.data, {
      repository: createSupabaseMedicationScanRepository(createAdminSupabaseClient()),
      profileId: access.profileId,
    });
    return { kind: "success", data: receipt };
  } catch {
    return internalError();
  }
}

export async function loadMedicationReviewForRequest(input: {
  subjectId: string;
  sessionId: string;
}): Promise<
  MedicationRequestResult<{
    sessionId: string;
    status: "NEEDS_CONFIRMATION" | "MANUAL_REQUIRED" | "NEEDS_RETAKE" | "COMPLETED";
    candidates: readonly import("./schema").MedicationCandidate[];
  }>
> {
  const parsed = z
    .object({ subjectId: UuidSchema, sessionId: UuidSchema })
    .strict()
    .safeParse(input);
  if (!parsed.success) return invalidRequest();
  const access = await authorize(parsed.data.subjectId);
  if (access.kind !== "allow") return access;

  try {
    const review = await createSupabaseMedicationScanRepository(
      createAdminSupabaseClient(),
    ).loadOwnedReview({ ...parsed.data, profileId: access.profileId });
    return review
      ? { kind: "success", data: review }
      : { kind: "error", error: createPublicError("NOT_FOUND") };
  } catch {
    return internalError();
  }
}

export async function loadMedicationReceiptForRequest(input: {
  subjectId: string;
  requestId: string;
}): Promise<MedicationRequestResult<MedicationConfirmationReceipt>> {
  const parsed = z
    .object({ subjectId: UuidSchema, requestId: UuidSchema })
    .strict()
    .safeParse(input);
  if (!parsed.success) return invalidRequest();
  const access = await authorize(parsed.data.subjectId);
  if (access.kind !== "allow") return access;

  try {
    const receipt = await createSupabaseMedicationScanRepository(
      createAdminSupabaseClient(),
    ).loadReceipt(parsed.data);
    return receipt
      ? { kind: "success", data: receipt }
      : { kind: "error", error: createPublicError("NOT_FOUND") };
  } catch {
    return internalError();
  }
}
