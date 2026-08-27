import "@tanstack/react-start/server-only";

import { z } from "zod";

const requiredValue = (name: string) =>
  z
    .string({ required_error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

const optionalValue = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const supabaseProjectUrl = requiredValue("SUPABASE_URL")
  .url("SUPABASE_URL must be an absolute URL")
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.pathname !== "/" || url.search || url.hash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SUPABASE_URL must be the project root URL without /rest/v1 or another path",
      });
    }
  })
  .transform((value) => new URL(value).origin);

const futurePrivateKey = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{64}$/, "EAS_ATTESTER_PRIVATE_KEY must be a 32-byte hex key")
    .optional(),
);

export const serverEnvSchema = z.object({
  SUPABASE_URL: supabaseProjectUrl,
  SUPABASE_PUBLISHABLE_KEY: requiredValue("SUPABASE_PUBLISHABLE_KEY"),
  SUPABASE_SECRET_KEY: requiredValue("SUPABASE_SECRET_KEY"),
  DATA_GO_SERVICE_KEY: requiredValue("DATA_GO_SERVICE_KEY"),
  KMA_APIHUB_AUTH_KEY: requiredValue("KMA_APIHUB_AUTH_KEY"),
  GEMINI_API_KEY: requiredValue("GEMINI_API_KEY"),
  GEMINI_MODEL: z.literal("gemini-3.5-flash").default("gemini-3.5-flash"),
  NAVER_MAPS_CLIENT_ID: requiredValue("NAVER_MAPS_CLIENT_ID"),
  NAVER_MAPS_CLIENT_SECRET: requiredValue("NAVER_MAPS_CLIENT_SECRET"),
  TMAP_APP_KEY: requiredValue("TMAP_APP_KEY"),
  KAKAO_REST_API_KEY: optionalValue,
  PUBLIC_APP_ORIGIN: optionalValue,
  NOTIFICATION_PROVIDER: z.literal("disabled").default("disabled"),
  NOTIFICATION_LIVE_SEND_ENABLED: z
    .literal("false")
    .default("false")
    .transform(() => false as const),
  BASE_SEPOLIA_RPC_URL: optionalValue,
  EAS_ATTESTER_PRIVATE_KEY: futurePrivateKey,
  EAS_CARE_SCHEMA_UID: optionalValue,
  EAS_SHELTER_SCHEMA_UID: optionalValue,
  EAS_EXPECTED_ISSUER: optionalValue,
  SUBJECT_HASH_SECRET: optionalValue,
  REPORTER_HASH_SECRET: optionalValue,
  CRON_SECRET: optionalValue,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(environment: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(environment);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");

  // Deliberately report only variable names and schema messages, never received values.
  throw new Error(`Invalid server environment: ${issues}`);
}

let cachedServerEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}
