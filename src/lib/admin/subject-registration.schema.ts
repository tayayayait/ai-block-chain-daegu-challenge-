import { z } from "zod";

const currentYear = new Date().getUTCFullYear();
const OptionalPhoneSchema = z.preprocess(
  (value) => (value === null ? "" : value),
  z
    .string()
    .trim()
    .max(24)
    .transform((value) => value.replace(/[^0-9]/gu, ""))
    .refine((value) => value === "" || /^0\d{8,10}$/u.test(value), "invalid phone")
    .transform((value) => (value === "" ? null : value)),
);

export const subjectRegistrationInputSchema = z
  .object({
    registrationRequestId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    birthYear: z
      .number()
      .int()
      .min(currentYear - 130)
      .max(currentYear),
    sex: z.enum(["FEMALE", "MALE", "OTHER", "UNDISCLOSED"]),
    phone: OptionalPhoneSchema,
    guardianPhone: OptionalPhoneSchema,
    address: z.string().trim().min(2).max(120),
    livesAlone: z.boolean(),
    chronicDisease: z.boolean(),
    hasCooling: z.boolean(),
    seniorMode: z.boolean(),
    consent: z.literal(true),
  })
  .strict();

export type SubjectRegistrationInput = z.input<typeof subjectRegistrationInputSchema>;
export type ParsedSubjectRegistrationInput = z.output<typeof subjectRegistrationInputSchema>;

export type SubjectRegistrationErrorCode =
  | "AUTH_REQUIRED"
  | "ADMIN_REQUIRED"
  | "INVALID_INPUT"
  | "ADDRESS_NOT_FOUND"
  | "ADDRESS_AMBIGUOUS"
  | "ADDRESS_LOOKUP_UNAVAILABLE"
  | "SAVE_FAILED";

export type SubjectRegistrationResult =
  | Readonly<{
      kind: "success";
      subjectId: string;
      canonicalAddress: string;
      initialRisk: "READY" | "DELAYED";
    }>
  | Readonly<{
      kind: "error";
      code: SubjectRegistrationErrorCode;
      userMessage: string;
    }>;
