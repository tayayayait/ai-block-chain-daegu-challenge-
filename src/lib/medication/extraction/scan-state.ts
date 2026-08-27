import { z } from "zod";

import {
  MedicationExtractionSchema,
  MedicationImageQualitySchema,
  type MedicationExtraction,
  type MedicationImageQuality,
} from "./schema";

export const IMAGE_QUALITY_MESSAGES = Object.freeze({
  BLURRY: "사진이 흔들렸습니다. 팔을 고정하고 다시 찍어주세요.",
  PARTIAL: "약봉투 일부만 보입니다. 전체가 들어오게 찍어주세요.",
  UNREADABLE: "글자를 읽을 수 없습니다.",
} satisfies Record<Exclude<MedicationImageQuality, "GOOD">, string>);

const ScanStateInputSchema = z
  .object({
    previousAttemptCount: z.number().int().min(0).max(3),
    imageQuality: MedicationImageQualitySchema,
  })
  .strict();

export type MedicationScanDecision =
  | Readonly<{
      status: "NEEDS_CONFIRMATION";
      attemptCount: number;
      imageQuality: "GOOD";
      userMessage: null;
    }>
  | Readonly<{
      status: "NEEDS_RETAKE" | "MANUAL_REQUIRED";
      attemptCount: number;
      imageQuality: Exclude<MedicationImageQuality, "GOOD">;
      userMessage: string;
    }>;

export function decideMedicationScanState(input: {
  previousAttemptCount: number;
  imageQuality: MedicationImageQuality;
}): MedicationScanDecision {
  const parsed = ScanStateInputSchema.parse(input);
  const attemptCount = Math.min(parsed.previousAttemptCount + 1, 3);

  if (parsed.imageQuality === "GOOD") {
    return Object.freeze({
      status: "NEEDS_CONFIRMATION",
      attemptCount,
      imageQuality: parsed.imageQuality,
      userMessage: null,
    });
  }

  const baseMessage = IMAGE_QUALITY_MESSAGES[parsed.imageQuality];
  if (attemptCount >= 3) {
    return Object.freeze({
      status: "MANUAL_REQUIRED",
      attemptCount,
      imageQuality: parsed.imageQuality,
      userMessage: `${baseMessage} 직접 입력해 주세요.`,
    });
  }

  return Object.freeze({
    status: "NEEDS_RETAKE",
    attemptCount,
    imageQuality: parsed.imageQuality,
    userMessage: baseMessage,
  });
}

const ConfirmationInputSchema = z
  .object({
    userConfirmed: z.literal(true),
    extraction: MedicationExtractionSchema,
  })
  .strict();

export function confirmMedicationExtraction(input: {
  userConfirmed: boolean;
  extraction: MedicationExtraction;
}): Readonly<{ canPersist: true; extraction: MedicationExtraction }> {
  const parsed = ConfirmationInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("MEDICATION_CONFIRMATION_REQUIRED");

  return Object.freeze({ canPersist: true, extraction: parsed.data.extraction });
}
