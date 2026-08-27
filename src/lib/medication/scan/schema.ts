import { z } from "zod";

import { MED_RISK_TIERS, MED_SOURCES } from "@/lib/domain-types";
import { HEAT_MEDICATION_CLASSES } from "@/lib/medication/classify";
import { HEAT_CLASS_TIER } from "@/lib/medication/heat-classes";

const UuidSchema = z.string().uuid();
const OptionalItemSeqSchema = z.union([z.literal(""), z.string().regex(/^\d{1,20}$/)]);
const OptionalTextSchema = z.string().trim().max(500);
const OptionalHeatClassSchema = z.union([z.literal(""), z.enum(HEAT_MEDICATION_CLASSES)]);
const NullableProviderTextSchema = z.string().trim().max(20_000).nullable();
const NullableProviderUrlSchema = z.string().trim().url().max(2_048).nullable();

export const MedicationEvidenceSourceSchema = z.enum(["GEMINI_MFDS", "GEMINI_ONLY", "MANUAL"]);
export const MedicationProviderAvailabilitySchema = z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]);
export const MedicationMfdsMatchMethodSchema = z.enum([
  "PRODUCT_NAME_EXACT",
  "PRODUCT_NAME_NORMALIZED",
  "ITEM_SEQ",
  "PHYSICAL",
]);

export const MedicationEasyDrugEvidenceSchema = z
  .object({
    itemSeq: z.string().regex(/^\d{1,20}$/),
    itemName: z.string().trim().min(1).max(500),
    manufacturerName: NullableProviderTextSchema,
    efficacy: NullableProviderTextSchema,
    usage: NullableProviderTextSchema,
    warning: NullableProviderTextSchema,
    caution: NullableProviderTextSchema,
    interaction: NullableProviderTextSchema,
    sideEffects: NullableProviderTextSchema,
    storage: NullableProviderTextSchema,
    openDate: z
      .string()
      .regex(/^\d{8}$/)
      .nullable(),
    updateDate: z
      .string()
      .regex(/^\d{8}$/)
      .nullable(),
    productImageUrl: NullableProviderUrlSchema,
  })
  .strict();

export const MedicationDurEvidenceItemSchema = z
  .object({
    operation: z.enum([
      "PRODUCT",
      "COMBINATION_CONTRAINDICATION",
      "ELDERLY_CAUTION",
      "AGE_CONTRAINDICATION",
      "CAPACITY_CAUTION",
      "DURATION_CAUTION",
      "EFFICACY_DUPLICATION",
      "EXTENDED_RELEASE_SPLIT_CAUTION",
      "PREGNANCY_CONTRAINDICATION",
    ]),
    itemSeq: z.string().regex(/^\d{1,20}$/),
    itemName: NullableProviderTextSchema,
    manufacturerName: NullableProviderTextSchema,
    ingredientName: NullableProviderTextSchema,
    relatedItemSeq: z
      .string()
      .regex(/^\d{1,20}$/)
      .nullable(),
    relatedItemName: NullableProviderTextSchema,
    relatedIngredientName: NullableProviderTextSchema,
    typeName: NullableProviderTextSchema,
    cautionText: NullableProviderTextSchema,
    threshold: NullableProviderTextSchema,
  })
  .strict();

const MedicationDurOperationEvidenceSchema = z
  .object({
    status: MedicationProviderAvailabilitySchema,
    totalCount: z.number().int().nonnegative().nullable(),
    items: z.array(MedicationDurEvidenceItemSchema).max(10),
  })
  .strict();

export const MedicationDurEvidenceSchema = z
  .object({
    PRODUCT: MedicationDurOperationEvidenceSchema,
    COMBINATION_CONTRAINDICATION: MedicationDurOperationEvidenceSchema,
    ELDERLY_CAUTION: MedicationDurOperationEvidenceSchema,
    AGE_CONTRAINDICATION: MedicationDurOperationEvidenceSchema,
    CAPACITY_CAUTION: MedicationDurOperationEvidenceSchema,
    DURATION_CAUTION: MedicationDurOperationEvidenceSchema,
    EFFICACY_DUPLICATION: MedicationDurOperationEvidenceSchema,
    EXTENDED_RELEASE_SPLIT_CAUTION: MedicationDurOperationEvidenceSchema,
    PREGNANCY_CONTRAINDICATION: MedicationDurOperationEvidenceSchema,
  })
  .strict();

export const MedicationMfdsEvidenceSchema = z
  .object({
    matchMethod: MedicationMfdsMatchMethodSchema.nullable(),
    productImageUrl: NullableProviderUrlSchema,
    sourceStatus: z
      .object({
        pillIdentification: MedicationProviderAvailabilitySchema,
        easyDrug: MedicationProviderAvailabilitySchema,
        dur: MedicationProviderAvailabilitySchema,
      })
      .strict(),
    easyDrug: MedicationEasyDrugEvidenceSchema.nullable(),
    dur: MedicationDurEvidenceSchema.nullable(),
  })
  .strict();

export const MedicationCandidateSchema = z
  .object({
    candidateId: UuidSchema,
    productName: z.string().trim().min(1, "제품명을 입력해 주세요.").max(200),
    itemSeq: z.string().nullable(),
    manufacturerName: z.string().nullable(),
    ingredientName: z.string().nullable(),
    heatClass: z.enum(HEAT_MEDICATION_CLASSES).nullable(),
    riskTier: z.enum(MED_RISK_TIERS),
    confidence: z.number().finite().min(0).max(1).nullable(),
    source: z.enum(MED_SOURCES),
    evidenceSource: MedicationEvidenceSourceSchema,
    selected: z.boolean(),
    // Optional keeps persisted pre-enrichment review sessions backwards compatible.
    mfds: MedicationMfdsEvidenceSchema.optional(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if ((candidate.riskTier === "NONE") !== (candidate.heatClass === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["heatClass"],
        message: "위험 등급과 약물군을 함께 확인해 주세요.",
      });
    } else if (
      candidate.heatClass !== null &&
      HEAT_CLASS_TIER[candidate.heatClass] !== candidate.riskTier
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["riskTier"],
        message: "약물군에 맞는 위험 등급을 선택해 주세요.",
      });
    }
  });

export type MedicationCandidate = z.infer<typeof MedicationCandidateSchema>;

export const MedicationReviewEntrySchema = z
  .object({
    candidateId: UuidSchema,
    productName: z.string().trim().min(1, "제품명을 입력해 주세요.").max(200),
    itemSeq: OptionalItemSeqSchema,
    manufacturerName: OptionalTextSchema,
    ingredientName: OptionalTextSchema,
    heatClass: OptionalHeatClassSchema,
    riskTier: z.enum(MED_RISK_TIERS),
    confidence: z.number().finite().min(0).max(1).nullable(),
    source: z.enum(MED_SOURCES),
    evidenceSource: MedicationEvidenceSourceSchema,
    selected: z.boolean(),
  })
  .strict()
  .superRefine((medication, context) => {
    if ((medication.riskTier === "NONE") !== (medication.heatClass === "")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["heatClass"],
        message: "위험 등급과 약물군을 함께 확인해 주세요.",
      });
    } else if (
      medication.heatClass !== "" &&
      HEAT_CLASS_TIER[medication.heatClass] !== medication.riskTier
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["riskTier"],
        message: "약물군에 맞는 위험 등급을 선택해 주세요.",
      });
    }
  });

export const MedicationReviewFormSchema = z
  .object({
    requestId: UuidSchema,
    subjectId: UuidSchema,
    scanSessionId: UuidSchema.nullable(),
    policy: z.enum(["ADD", "REPLACE"]),
    confirmed: z.boolean().refine((value) => value, {
      message: "내용을 확인했다는 동의가 필요합니다.",
    }),
    medications: z.array(MedicationReviewEntrySchema).min(1).max(30),
  })
  .strict()
  .superRefine((form, context) => {
    if (!form.medications.some((medication) => medication.selected)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["medications"],
        message: "등록할 약을 한 개 이상 선택해 주세요.",
      });
    }
  });

export type MedicationReviewFormValues = z.infer<typeof MedicationReviewFormSchema>;

export const MedicationManualInputSchema = z
  .object({
    subjectId: UuidSchema,
    productName: z.string().trim().min(1, "제품명을 입력해 주세요.").max(200),
    itemSeq: OptionalItemSeqSchema,
    ingredientName: OptionalTextSchema,
  })
  .strict();

export type MedicationManualInput = z.infer<typeof MedicationManualInputSchema>;

export const MedicationEvidenceEnrichmentInputSchema = z
  .object({
    subjectId: UuidSchema,
    scanSessionId: UuidSchema,
    candidateId: UuidSchema,
    productName: z.string().trim().min(1, "제품명을 입력해 주세요.").max(200),
    itemSeq: OptionalItemSeqSchema,
    ingredientName: OptionalTextSchema,
  })
  .strict();

export type MedicationEvidenceEnrichmentInput = z.infer<
  typeof MedicationEvidenceEnrichmentInputSchema
>;

export const MedicationScanSearchSchema = z
  .object({
    step: z.enum(["capture", "review", "complete"]).default("capture"),
    scan: UuidSchema.optional(),
    receipt: UuidSchema.optional(),
  })
  .strict()
  .superRefine((search, context) => {
    if (search.step === "review" && !search.scan) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scan"],
        message: "검토할 스캔이 필요합니다.",
      });
    }
    if (search.step === "complete" && !search.receipt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt"],
        message: "완료 결과가 필요합니다.",
      });
    }
  });

export type MedicationScanSearch = z.infer<typeof MedicationScanSearchSchema>;

export function medicationReviewDefaultValues(input: {
  requestId: string;
  subjectId: string;
  scanSessionId: string | null;
  candidates: readonly MedicationCandidate[];
}): MedicationReviewFormValues {
  return {
    requestId: input.requestId,
    subjectId: input.subjectId,
    scanSessionId: input.scanSessionId,
    policy: "ADD",
    confirmed: false,
    medications: input.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      productName: candidate.productName,
      itemSeq: candidate.itemSeq ?? "",
      manufacturerName: candidate.manufacturerName ?? "",
      ingredientName: candidate.ingredientName ?? "",
      heatClass: candidate.heatClass ?? "",
      riskTier: candidate.riskTier,
      confidence: candidate.confidence,
      source: candidate.source,
      evidenceSource: candidate.evidenceSource,
      selected: candidate.selected,
    })),
  };
}
