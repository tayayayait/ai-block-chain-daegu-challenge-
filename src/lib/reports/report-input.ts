import { z } from "zod";

const reportBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const optionalCrowd = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.enum(["SPARSE", "MODERATE", "CROWDED"]).optional(),
);

export const ShelterReportInputSchema = z
  .object({
    shelterId: z.string().regex(/^DG-\d{4}$/),
    isOpen: reportBoolean,
    crowd: optionalCrowd,
    clientRequestId: z.string().uuid(),
  })
  .strict();

export type ShelterReportInput = z.infer<typeof ShelterReportInputSchema>;

export function parseShelterReportInput(input: unknown): ShelterReportInput {
  return ShelterReportInputSchema.parse(input);
}

export const CROWD_TO_DB_VALUE = Object.freeze({
  SPARSE: 0,
  MODERATE: 1,
  CROWDED: 2,
} as const);
