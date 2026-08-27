import { describe, expect, it } from "vitest";

import { MEDICATION_EXTRACTION_JSON_SCHEMA } from "./schema-json.server";
import { MedicationExtractionSchema } from "./schema";

const validExtraction = {
  imageQuality: "GOOD",
  items: [
    {
      rawText: "타이레놀정 500mg 1일 3회",
      productName: "타이레놀정 500mg",
      shape: "장방형",
      color: "흰색",
      imprint: "TYLENOL",
      dosageText: "1일 3회",
      confidence: 0.94,
    },
  ],
} as const;

describe("MedicationExtractionSchema", () => {
  it("accepts the strict medication extraction contract", () => {
    expect(MedicationExtractionSchema.parse(validExtraction)).toEqual(validExtraction);
  });

  it.each([
    { ...validExtraction, providerTrace: "private" },
    {
      ...validExtraction,
      items: [{ ...validExtraction.items[0], confidence: 1.01 }],
    },
    {
      ...validExtraction,
      items: [{ ...validExtraction.items[0], shape: "별모양" }],
    },
    {
      ...validExtraction,
      items: [{ ...validExtraction.items[0], unknown: "private" }],
    },
  ])("rejects unknown fields and values outside the extraction contract", (value) => {
    expect(MedicationExtractionSchema.safeParse(value).success).toBe(false);
  });

  it("derives one strict JSON Schema for Gemini from the same Zod schema", () => {
    expect(MEDICATION_EXTRACTION_JSON_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining(["imageQuality", "items"]),
      properties: {
        imageQuality: {
          type: "string",
          enum: ["GOOD", "BLURRY", "PARTIAL", "UNREADABLE"],
        },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: expect.arrayContaining(["rawText", "confidence"]),
          },
        },
      },
    });
  });
});
