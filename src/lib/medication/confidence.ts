import { z } from "zod";

const ConfidenceSchema = z.number().finite().min(0).max(1);

export type MedicationConfidenceDisposition = "AUTO" | "CONFIRM" | "EXCLUDE";

export interface MedicationConfidencePolicy {
  disposition: MedicationConfidenceDisposition;
  selectedByDefault: boolean;
  editable: boolean;
  requiresManualEntry: boolean;
}

export function resolveMedicationConfidence(confidence: number): MedicationConfidencePolicy {
  const result = ConfidenceSchema.safeParse(confidence);
  if (!result.success) throw new Error("INVALID_MEDICATION_CONFIDENCE");

  if (result.data >= 0.85) {
    return {
      disposition: "AUTO",
      selectedByDefault: true,
      editable: false,
      requiresManualEntry: false,
    };
  }
  if (result.data >= 0.6) {
    return {
      disposition: "CONFIRM",
      selectedByDefault: true,
      editable: true,
      requiresManualEntry: false,
    };
  }
  return {
    disposition: "EXCLUDE",
    selectedByDefault: false,
    editable: false,
    requiresManualEntry: true,
  };
}
