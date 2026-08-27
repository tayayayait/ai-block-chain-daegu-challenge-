import { describe, expect, it } from "vitest";

import {
  MedicationCandidateSchema,
  MedicationReviewFormSchema,
  MedicationScanSearchSchema,
  medicationReviewDefaultValues,
} from "./schema";

const subjectId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";

describe("medication scan shared schemas", () => {
  it("normalizes the three URL-addressable steps and requires their identifiers", () => {
    expect(MedicationScanSearchSchema.parse({})).toEqual({ step: "capture" });
    expect(
      MedicationScanSearchSchema.parse({
        step: "review",
        scan: "00000000-0000-4000-8000-000000000003",
      }),
    ).toMatchObject({ step: "review" });
    expect(() => MedicationScanSearchSchema.parse({ step: "review" })).toThrow();
    expect(() => MedicationScanSearchSchema.parse({ step: "complete" })).toThrow();
  });

  it("refuses persistence until confirmation is literal true and one medicine is selected", () => {
    const defaults = medicationReviewDefaultValues({
      requestId,
      subjectId,
      scanSessionId: null,
      candidates: [
        {
          candidateId: "00000000-0000-4000-8000-000000000004",
          productName: "온중정",
          itemSeq: "200000001",
          manufacturerName: "온중제약",
          ingredientName: "푸로세미드",
          heatClass: "이뇨제",
          riskTier: "HIGH",
          confidence: 0.91,
          source: "AI_AUTO",
          evidenceSource: "GEMINI_MFDS",
          selected: true,
        },
      ],
    });

    expect(defaults.confirmed).toBe(false);
    expect(MedicationReviewFormSchema.safeParse(defaults).success).toBe(false);
    expect(MedicationReviewFormSchema.safeParse({ ...defaults, confirmed: true }).success).toBe(
      true,
    );
    expect(
      MedicationReviewFormSchema.safeParse({
        ...defaults,
        confirmed: true,
        medications: defaults.medications.map((medication) => ({
          ...medication,
          selected: false,
        })),
      }).success,
    ).toBe(false);
  });

  it("enforces the heat-class and risk-tier invariant on client and server", () => {
    const defaults = medicationReviewDefaultValues({
      requestId,
      subjectId,
      scanSessionId: null,
      candidates: [
        {
          candidateId: "00000000-0000-4000-8000-000000000005",
          productName: "일반정",
          itemSeq: null,
          manufacturerName: null,
          ingredientName: null,
          heatClass: null,
          riskTier: "NONE",
          confidence: null,
          source: "MANUAL",
          evidenceSource: "MANUAL",
          selected: true,
        },
      ],
    });

    const invalid = {
      ...defaults,
      confirmed: true,
      medications: defaults.medications.map((medication) => ({
        ...medication,
        heatClass: "",
        riskTier: "HIGH" as const,
      })),
    };
    const result = MedicationReviewFormSchema.safeParse(invalid);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("heatClass"))).toBe(true);
    }
  });

  it("rejects a tier that does not match the canonical heat-medication class", () => {
    const defaults = medicationReviewDefaultValues({
      requestId,
      subjectId,
      scanSessionId: null,
      candidates: [
        {
          candidateId: "00000000-0000-4000-8000-000000000006",
          productName: "혈압약",
          itemSeq: null,
          manufacturerName: null,
          ingredientName: "암로디핀",
          heatClass: "칼슘채널길항제",
          riskTier: "MID",
          confidence: null,
          source: "MANUAL",
          evidenceSource: "MANUAL",
          selected: true,
        },
      ],
    });

    const result = MedicationReviewFormSchema.safeParse({
      ...defaults,
      confirmed: true,
      medications: defaults.medications.map((medication) => ({
        ...medication,
        riskTier: "HIGH" as const,
      })),
    });

    expect(result.success).toBe(false);
  });

  it("keeps bounded MFDS review evidence on candidates but excludes it from confirmation input", () => {
    const candidate = MedicationCandidateSchema.parse({
      candidateId: "00000000-0000-4000-8000-000000000007",
      productName: "라식스정",
      itemSeq: "200000001",
      manufacturerName: "테스트제약",
      ingredientName: "푸로세미드",
      heatClass: "이뇨제",
      riskTier: "HIGH",
      confidence: 0.93,
      source: "AI_AUTO",
      evidenceSource: "GEMINI_MFDS",
      selected: true,
      mfds: {
        matchMethod: "PHYSICAL",
        productImageUrl: "https://example.test/pill.png",
        sourceStatus: {
          pillIdentification: "AVAILABLE",
          easyDrug: "AVAILABLE",
          dur: "PARTIAL",
        },
        easyDrug: {
          itemSeq: "200000001",
          itemName: "라식스정",
          manufacturerName: "테스트제약",
          efficacy: "부종 치료",
          usage: "의사의 지시에 따라 복용",
          warning: null,
          caution: "탈수에 주의",
          interaction: null,
          sideEffects: null,
          storage: "실온 보관",
          openDate: null,
          updateDate: null,
          productImageUrl: null,
        },
        dur: Object.fromEntries(
          [
            "PRODUCT",
            "COMBINATION_CONTRAINDICATION",
            "ELDERLY_CAUTION",
            "AGE_CONTRAINDICATION",
            "CAPACITY_CAUTION",
            "DURATION_CAUTION",
            "EFFICACY_DUPLICATION",
            "EXTENDED_RELEASE_SPLIT_CAUTION",
            "PREGNANCY_CONTRAINDICATION",
          ].map((operation) => [
            operation,
            {
              status: operation === "PREGNANCY_CONTRAINDICATION" ? "UNAVAILABLE" : "AVAILABLE",
              totalCount: operation === "PREGNANCY_CONTRAINDICATION" ? null : 0,
              items: [],
            },
          ]),
        ),
      },
    });

    expect(candidate.mfds?.sourceStatus.dur).toBe("PARTIAL");
    const defaults = medicationReviewDefaultValues({
      requestId,
      subjectId,
      scanSessionId: null,
      candidates: [candidate],
    });
    expect(defaults.medications[0]).not.toHaveProperty("mfds");
  });
});
