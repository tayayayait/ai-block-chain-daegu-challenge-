import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { RISK_LEVELS } from "@/lib/domain-types";
import { AppError } from "@/lib/error-dto";

import { MedicationCandidateSchema, type MedicationCandidate } from "./schema";
import type {
  MedicationConfirmationReceipt,
  MedicationEvidenceReviewRepository,
  MedicationScanRepository,
} from "./service";

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const SafeImagePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-attempt-[1-9][0-9]*\.(?:jpg|png|webp)$/u,
  );
const PrepareDispositionSchema = z.enum(["PREPARED", "IDEMPOTENT"]);
const AttachDispositionSchema = z.enum(["APPLIED", "IDEMPOTENT"]);
const CandidateReplacementDispositionSchema = z.literal("APPLIED");
const RiskPointSchema = z
  .object({ hri: z.number().int().min(0).max(100), level: z.enum(RISK_LEVELS) })
  .strict();

export const MedicationConfirmationReceiptSchema = z
  .object({
    request_id: UuidSchema,
    before: RiskPointSchema.nullable(),
    after: RiskPointSchema,
    medication_ids: z.array(UuidSchema).min(1).max(30),
    transition_created: z.boolean(),
  })
  .strict();

const ScanReviewRowSchema = z
  .object({
    id: UuidSchema,
    subject_id: UuidSchema,
    status: z.enum(["NEEDS_CONFIRMATION", "MANUAL_REQUIRED", "NEEDS_RETAKE", "COMPLETED"]),
    candidate_payload: z.array(MedicationCandidateSchema).max(30),
  })
  .strict();

const ResumableScanRowSchema = z
  .object({
    id: UuidSchema,
    subject_id: UuidSchema,
    image_path: z.string().min(1),
    status: z.enum(["NEEDS_RETAKE", "UPLOADED"]),
    attempt_count: z.number().int().min(1).max(2),
  })
  .strict();

const ReceiptRowSchema = z
  .object({
    request_id: UuidSchema,
    subject_id: UuidSchema,
    before_hri: z.number().int().min(0).max(100).nullable(),
    before_level: z.enum(RISK_LEVELS).nullable(),
    after_hri: z.number().int().min(0).max(100),
    after_level: z.enum(RISK_LEVELS),
    medication_ids: z.array(UuidSchema).min(1).max(30),
    transition_id: UuidSchema.nullable(),
  })
  .strict();

type ConfirmationInput = Parameters<MedicationScanRepository["confirmAtomically"]>[0];

export function toMedicationConfirmationRpcCommand(input: ConfirmationInput) {
  return {
    request_id: input.requestId,
    subject_id: input.subjectId,
    scan_session_id: input.scanSessionId,
    profile_id: input.profileId,
    policy: input.policy,
    confirmed_at: input.confirmedAt,
    medications: input.medications.map((medication) => ({
      product_name: medication.productName,
      item_seq: medication.itemSeq,
      ingredient_name: medication.ingredientName,
      heat_class: medication.heatClass,
      risk_tier: medication.riskTier,
      source: medication.source,
      confidence: medication.confidence,
    })),
  };
}

function receiptFromRpc(value: unknown): MedicationConfirmationReceipt {
  const row = MedicationConfirmationReceiptSchema.parse(value);
  return {
    requestId: row.request_id,
    before: row.before,
    after: row.after,
    medicationIds: row.medication_ids,
    transitionCreated: row.transition_created,
  };
}

function receiptFromRow(value: unknown): MedicationConfirmationReceipt {
  const row = ReceiptRowSchema.parse(value);
  if ((row.before_hri === null) !== (row.before_level === null)) {
    throw new Error("MEDICATION_REPOSITORY_INVALID_RECEIPT");
  }
  return {
    requestId: row.request_id,
    before:
      row.before_hri === null || row.before_level === null
        ? null
        : { hri: row.before_hri, level: row.before_level },
    after: { hri: row.after_hri, level: row.after_level },
    medicationIds: row.medication_ids,
    transitionCreated: row.transition_id !== null,
  };
}

function databaseFailure(): Error {
  return new Error("MEDICATION_REPOSITORY_OPERATION_FAILED");
}

type CleanupJobIdInput = Readonly<{
  sessionId: string;
  imagePath: string;
  imageBytes: Uint8Array;
}>;

function deterministicCleanupJobId(input: CleanupJobIdInput): string {
  const digest = createHash("sha256")
    .update("onjung-medication-cleanup-v1\0", "utf8")
    .update(input.sessionId, "utf8")
    .update("\0", "utf8")
    .update(input.imagePath, "utf8")
    .update("\0", "utf8")
    .update(input.imageBytes)
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const value = digest.subarray(0, 16).toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function medicationRpc(
  client: SupabaseClient,
  name: string,
  parameters: Readonly<Record<string, unknown>>,
  options: Readonly<{ reviewConflict?: boolean }> = {},
): Promise<unknown> {
  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc(name, parameters);
  } catch {
    throw databaseFailure();
  }
  if (response.error !== null) {
    const errorCode = z.object({ code: z.string() }).passthrough().safeParse(response.error);
    if (options.reviewConflict && errorCode.success && errorCode.data.code === "40001") {
      throw new AppError("REVIEW_CHANGED");
    }
    throw databaseFailure();
  }
  return response.data;
}

async function uploadMedicationImage(
  client: SupabaseClient,
  imagePath: string,
  image: { bytes: Uint8Array; mimeType: string },
): Promise<void> {
  try {
    const upload = await client.storage.from("medication-images").upload(imagePath, image.bytes, {
      contentType: image.mimeType,
      cacheControl: "0",
      upsert: true,
    });
    if (upload.error) throw databaseFailure();
  } catch {
    throw databaseFailure();
  }
}

export type MedicationScanReadRepository = Readonly<{
  loadReview(input: { subjectId: string; sessionId: string }): Promise<Readonly<{
    sessionId: string;
    status: z.infer<typeof ScanReviewRowSchema>["status"];
    candidates: readonly MedicationCandidate[];
  }> | null>;
  loadReceipt(input: {
    subjectId: string;
    requestId: string;
  }): Promise<MedicationConfirmationReceipt | null>;
}>;

export function createSupabaseMedicationScanRepository(
  client: SupabaseClient,
  dependencies: Readonly<{
    cleanupJobIdFactory?: (input: CleanupJobIdInput) => string;
    now?: () => Date;
  }> = {},
): MedicationScanRepository & MedicationScanReadRepository & MedicationEvidenceReviewRepository {
  const cleanupJobIdFactory = dependencies.cleanupJobIdFactory ?? deterministicCleanupJobId;
  const now = dependencies.now ?? (() => new Date());

  async function prepareImageCleanup(input: {
    cleanupJobId: string;
    sessionId: string;
    imagePath: string;
    preparedAt: string;
  }): Promise<void> {
    const value = await medicationRpc(client, "prepare_medication_image_cleanup", {
      p_cleanup_job_id: UuidSchema.parse(input.cleanupJobId),
      p_session_id: UuidSchema.parse(input.sessionId),
      p_image_path: SafeImagePathSchema.parse(input.imagePath),
      p_prepared_at: TimestampSchema.parse(input.preparedAt),
    });
    if (!PrepareDispositionSchema.safeParse(value).success) throw databaseFailure();
  }

  return {
    async createImageSession(input): Promise<void> {
      const preparedAt = now().toISOString();
      const imagePath = SafeImagePathSchema.parse(input.imagePath);
      const cleanupJobId = UuidSchema.parse(
        cleanupJobIdFactory({
          sessionId: input.sessionId,
          imagePath,
          imageBytes: input.image.bytes,
        }),
      );
      await prepareImageCleanup({
        cleanupJobId,
        sessionId: input.sessionId,
        imagePath,
        preparedAt,
      });
      await uploadMedicationImage(client, imagePath, input.image);
      const attached = await medicationRpc(client, "attach_medication_image_session", {
        p_cleanup_job_id: cleanupJobId,
        p_session_id: UuidSchema.parse(input.sessionId),
        p_subject_id: UuidSchema.parse(input.subjectId),
        p_profile_id: UuidSchema.parse(input.profileId),
        p_image_path: imagePath,
        p_attached_at: TimestampSchema.parse(preparedAt),
      });
      if (!AttachDispositionSchema.safeParse(attached).success) throw databaseFailure();
    },

    async createManualSession(input): Promise<void> {
      const result = await client.from("medication_scan_sessions").insert({
        id: input.sessionId,
        subject_id: input.subjectId,
        image_path: null,
        input_method: "MANUAL",
        created_by: input.profileId,
        status: "NEEDS_CONFIRMATION",
        attempt_count: 0,
        candidate_payload: input.candidates,
        image_purge_state: "NOT_APPLICABLE",
      });
      if (result.error) throw databaseFailure();
    },

    async resumeImageSession(input) {
      const existingResult = await client
        .from("medication_scan_sessions")
        .select("id,subject_id,image_path,status,attempt_count")
        .eq("id", input.sessionId)
        .eq("subject_id", input.subjectId)
        .eq("created_by", input.profileId)
        .maybeSingle();
      if (existingResult.error || !existingResult.data) throw databaseFailure();
      const existing = ResumableScanRowSchema.safeParse(existingResult.data);
      if (!existing.success) throw databaseFailure();
      const expectedNextImagePath = `${input.subjectId}/${input.sessionId}-attempt-${existing.data.attempt_count + 1}.${input.image.extension}`;
      const nextImagePath =
        existing.data.status === "UPLOADED" ? existing.data.image_path : expectedNextImagePath;
      if (nextImagePath !== expectedNextImagePath) throw databaseFailure();
      const preparedAt = now().toISOString();
      const safeNextImagePath = SafeImagePathSchema.parse(nextImagePath);
      const cleanupJobId = UuidSchema.parse(
        cleanupJobIdFactory({
          sessionId: input.sessionId,
          imagePath: safeNextImagePath,
          imageBytes: input.image.bytes,
        }),
      );
      await prepareImageCleanup({
        cleanupJobId,
        sessionId: input.sessionId,
        imagePath: safeNextImagePath,
        preparedAt,
      });
      await uploadMedicationImage(client, safeNextImagePath, input.image);
      const previousAttemptCount = z
        .number()
        .int()
        .min(1)
        .max(2)
        .parse(
          await medicationRpc(client, "replace_medication_image_session", {
            p_cleanup_job_id: cleanupJobId,
            p_session_id: UuidSchema.parse(input.sessionId),
            p_subject_id: UuidSchema.parse(input.subjectId),
            p_profile_id: UuidSchema.parse(input.profileId),
            p_expected_attempt_count: existing.data.attempt_count,
            p_new_image_path: safeNextImagePath,
            p_replaced_at: TimestampSchema.parse(preparedAt),
          }),
        );
      return { previousAttemptCount };
    },

    async recordOutcome(input): Promise<void> {
      const result = await client
        .from("medication_scan_sessions")
        .update({
          status: input.status,
          attempt_count: input.attemptCount,
          model_id: input.modelId,
          image_quality: input.imageQuality,
          candidate_payload: input.candidates,
        })
        .eq("id", input.sessionId);
      if (result.error) throw databaseFailure();
    },

    async confirmAtomically(input): Promise<MedicationConfirmationReceipt> {
      const result = await client.rpc("confirm_medication_scan", {
        p_command: toMedicationConfirmationRpcCommand(input),
      });
      if (result.error) throw databaseFailure();
      return receiptFromRpc(result.data);
    },

    async loadReview(input) {
      const result = await client
        .from("medication_scan_sessions")
        .select("id,subject_id,status,candidate_payload")
        .eq("id", input.sessionId)
        .eq("subject_id", input.subjectId)
        .maybeSingle();
      if (result.error) throw databaseFailure();
      if (!result.data) return null;
      const row = ScanReviewRowSchema.parse(result.data);
      return { sessionId: row.id, status: row.status, candidates: row.candidate_payload };
    },

    async loadOwnedReview(input) {
      const result = await client
        .from("medication_scan_sessions")
        .select("id,subject_id,status,candidate_payload")
        .eq("id", UuidSchema.parse(input.sessionId))
        .eq("subject_id", UuidSchema.parse(input.subjectId))
        .eq("created_by", UuidSchema.parse(input.profileId))
        .maybeSingle();
      if (result.error) throw databaseFailure();
      if (!result.data) return null;
      const row = ScanReviewRowSchema.parse(result.data);
      return { sessionId: row.id, status: row.status, candidates: row.candidate_payload };
    },

    async replaceOwnedReviewCandidate(input): Promise<void> {
      const candidateId = UuidSchema.parse(input.candidateId);
      const expectedCandidate = MedicationCandidateSchema.parse(input.expectedCandidate);
      const replacementCandidate = MedicationCandidateSchema.parse(input.replacementCandidate);
      if (
        expectedCandidate.candidateId !== candidateId ||
        replacementCandidate.candidateId !== candidateId
      ) {
        throw databaseFailure();
      }
      const value = await medicationRpc(
        client,
        "replace_medication_review_candidate",
        {
          p_command: {
            subject_id: UuidSchema.parse(input.subjectId),
            scan_session_id: UuidSchema.parse(input.sessionId),
            profile_id: UuidSchema.parse(input.profileId),
            candidate_id: candidateId,
            expected_candidate: expectedCandidate,
            replacement_candidate: replacementCandidate,
          },
        },
        { reviewConflict: true },
      );
      if (!CandidateReplacementDispositionSchema.safeParse(value).success) throw databaseFailure();
    },

    async loadReceipt(input) {
      const result = await client
        .from("medication_confirmation_receipts")
        .select(
          "request_id,subject_id,before_hri,before_level,after_hri,after_level,medication_ids,transition_id",
        )
        .eq("request_id", input.requestId)
        .eq("subject_id", input.subjectId)
        .maybeSingle();
      if (result.error) throw databaseFailure();
      return result.data ? receiptFromRow(result.data) : null;
    },
  };
}
