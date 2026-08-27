import { describe, expect, it } from "vitest";
import { resolveMedicationConfidence } from "./confidence";

describe("medication confidence policy", () => {
  it.each([0.85, 1])("marks %s as AUTO and selected", (confidence) => {
    expect(resolveMedicationConfidence(confidence)).toEqual({
      disposition: "AUTO",
      selectedByDefault: true,
      editable: false,
      requiresManualEntry: false,
    });
  });

  it.each([0.6, 0.84, 0.849999])("marks %s as CONFIRM and editable", (confidence) => {
    expect(resolveMedicationConfidence(confidence)).toEqual({
      disposition: "CONFIRM",
      selectedByDefault: true,
      editable: true,
      requiresManualEntry: false,
    });
  });

  it.each([0, 0.59, 0.599999])("excludes %s and opens manual entry", (confidence) => {
    expect(resolveMedicationConfidence(confidence)).toEqual({
      disposition: "EXCLUDE",
      selectedByDefault: false,
      editable: false,
      requiresManualEntry: true,
    });
  });

  it.each([-0.01, 1.01, Number.NaN])("rejects invalid confidence %s", (confidence) => {
    expect(() => resolveMedicationConfidence(confidence)).toThrow("INVALID_MEDICATION_CONFIDENCE");
  });
});
