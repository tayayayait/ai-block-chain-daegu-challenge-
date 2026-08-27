import { describe, expect, it } from "vitest";

import { MedicationExtractionSchema } from "./schema";
import {
  confirmMedicationExtraction,
  decideMedicationScanState,
  IMAGE_QUALITY_MESSAGES,
} from "./scan-state";

describe("medication image-quality state", () => {
  it.each([
    ["BLURRY", "사진이 흔들렸습니다. 팔을 고정하고 다시 찍어주세요."],
    ["PARTIAL", "약봉투 일부만 보입니다. 전체가 들어오게 찍어주세요."],
    ["UNREADABLE", "글자를 읽을 수 없습니다."],
  ] as const)("maps %s to the fixed actionable copy", (quality, message) => {
    expect(IMAGE_QUALITY_MESSAGES[quality]).toBe(message);
    expect(decideMedicationScanState({ previousAttemptCount: 0, imageQuality: quality })).toEqual({
      status: "NEEDS_RETAKE",
      attemptCount: 1,
      imageQuality: quality,
      userMessage: message,
    });
  });

  it("switches to MANUAL_REQUIRED on the third consecutive bad capture", () => {
    expect(
      decideMedicationScanState({ previousAttemptCount: 2, imageQuality: "UNREADABLE" }),
    ).toEqual({
      status: "MANUAL_REQUIRED",
      attemptCount: 3,
      imageQuality: "UNREADABLE",
      userMessage: "글자를 읽을 수 없습니다. 직접 입력해 주세요.",
    });
  });

  it("requires user confirmation before an extraction becomes persistable", () => {
    const extraction = MedicationExtractionSchema.parse({
      imageQuality: "GOOD",
      items: [{ rawText: "테스트정", confidence: 0.91 }],
    });

    expect(() => confirmMedicationExtraction({ userConfirmed: false, extraction })).toThrowError(
      "MEDICATION_CONFIRMATION_REQUIRED",
    );
    expect(confirmMedicationExtraction({ userConfirmed: true, extraction })).toEqual({
      canPersist: true,
      extraction,
    });
  });
});
