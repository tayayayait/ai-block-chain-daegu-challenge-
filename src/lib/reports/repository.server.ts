import "@tanstack/react-start/server-only";

import { z } from "zod";

import { ATTEST_STATES } from "@/lib/domain-types";
import { AppError } from "@/lib/error-dto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";
import {
  CROWD_TO_DB_VALUE,
  ShelterReportInputSchema,
  type ShelterReportInput,
} from "./report-input";

export interface ShelterReportRpcClient {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown; readonly error: unknown }>;
}

const ReporterHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const AttestationJobStateSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "RETRY_WAIT",
  "VERIFIED",
  "FAILED",
]);

const SubmissionRpcRowSchema = z
  .object({
    outcome: z.enum(["ACCEPTED", "IDEMPOTENT", "DUPLICATE", "RATE_LIMITED"]),
    report_id: z.string().uuid().nullable(),
    retry_after: z.string().datetime({ offset: true }).nullable(),
    attestation_state: z.enum(ATTEST_STATES),
    attestation_job_state: AttestationJobStateSchema,
  })
  .strict();

export type ShelterReportSubmissionResult =
  | Readonly<{
      outcome: "ACCEPTED" | "IDEMPOTENT";
      reportId: string;
      attest: (typeof ATTEST_STATES)[number];
      jobState: z.infer<typeof AttestationJobStateSchema>;
    }>
  | Readonly<{
      outcome: "DUPLICATE" | "RATE_LIMITED";
      retryAfter: string;
    }>;

export interface ShelterReportRepository {
  submit(input: ShelterReportInput, reporterHash: string): Promise<ShelterReportSubmissionResult>;
}

function defaultRpcClient(): ShelterReportRpcClient {
  return createAdminSupabaseClient() as unknown as ShelterReportRpcClient;
}

function databaseErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function appErrorForDatabase(error: unknown): AppError {
  const code = databaseErrorCode(error);
  if (code === "23503") return new AppError("NOT_FOUND");
  if (code === "22023") return new AppError("INVALID_REQUEST");
  return new AppError("SERVER_TEMPORARY");
}

export function createSupabaseShelterReportRepository(
  client: ShelterReportRpcClient = defaultRpcClient(),
): ShelterReportRepository {
  return Object.freeze({
    async submit(
      rawInput: ShelterReportInput,
      rawReporterHash: string,
    ): Promise<ShelterReportSubmissionResult> {
      const input = ShelterReportInputSchema.parse(rawInput);
      const reporterHash = ReporterHashSchema.parse(rawReporterHash);
      const response = await client.rpc("submit_shelter_report", {
        p_shelter_id: input.shelterId,
        p_is_open: input.isOpen,
        p_crowd_level: input.crowd === undefined ? null : CROWD_TO_DB_VALUE[input.crowd],
        p_reporter_hash: reporterHash,
        p_client_request_id: input.clientRequestId,
      });

      if (response.error !== null) throw appErrorForDatabase(response.error);

      const parsed = z.array(SubmissionRpcRowSchema).length(1).safeParse(response.data);
      if (!parsed.success) throw new AppError("SERVER_TEMPORARY");
      const row = parsed.data[0];
      if (row === undefined) throw new AppError("SERVER_TEMPORARY");

      if (row.outcome === "ACCEPTED" || row.outcome === "IDEMPOTENT") {
        if (row.report_id === null || row.retry_after !== null) {
          throw new AppError("SERVER_TEMPORARY");
        }
        return Object.freeze({
          outcome: row.outcome,
          reportId: row.report_id,
          attest: row.attestation_state,
          // A report without observed crowd data remains a valid off-chain
          // report, but it is intentionally ineligible for the current EAS schema.
          jobState: input.crowd === undefined ? "FAILED" : row.attestation_job_state,
        });
      }

      if (row.report_id !== null || row.retry_after === null) {
        throw new AppError("SERVER_TEMPORARY");
      }
      return Object.freeze({ outcome: row.outcome, retryAfter: row.retry_after });
    },
  });
}
