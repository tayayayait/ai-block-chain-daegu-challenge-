import { z } from "zod";

export const MedicationImageQualitySchema = z.enum(["GOOD", "BLURRY", "PARTIAL", "UNREADABLE"]);

export const MedicationShapeSchema = z.enum(["원형", "타원형", "장방형", "삼각형", "기타", "불명"]);

const optionalExtractedText = z.string().trim().min(1).max(500).optional();

export const MedicationExtractionItemSchema = z
  .object({
    rawText: z.string().trim().min(1).max(1_000),
    productName: optionalExtractedText,
    shape: MedicationShapeSchema.optional(),
    color: optionalExtractedText,
    imprint: optionalExtractedText,
    dosageText: optionalExtractedText,
    confidence: z.number().finite().min(0).max(1),
  })
  .strict();

export const MedicationExtractionSchema = z
  .object({
    imageQuality: MedicationImageQualitySchema,
    items: z.array(MedicationExtractionItemSchema).max(30),
  })
  .strict();

export type MedicationImageQuality = z.infer<typeof MedicationImageQualitySchema>;
export type MedicationExtraction = z.infer<typeof MedicationExtractionSchema>;
