import "@tanstack/react-start/server-only";

import { AppError } from "@/lib/error-dto";
import {
  resolveAnonymousReporterSession,
  type AnonymousReporterIdentity,
} from "./anonymous-session.server";
import {
  createSupabaseShelterReportRepository,
  type ShelterReportRepository,
  type ShelterReportSubmissionResult,
} from "./repository.server";
import { ShelterReportInputSchema, type ShelterReportInput } from "./report-input";

export interface AnonymousReportRequest {
  readonly input: ShelterReportInput;
  readonly cookieHeader: string | null;
  readonly reporterHashSecret: string;
  readonly secureCookie: boolean;
}

export interface AnonymousReportResponse {
  readonly result: ShelterReportSubmissionResult;
  readonly setCookie: string | null;
}

export async function submitAnonymousShelterReport(
  request: AnonymousReportRequest,
  repository: ShelterReportRepository = createSupabaseShelterReportRepository(),
): Promise<AnonymousReportResponse> {
  const parsedInput = ShelterReportInputSchema.safeParse(request.input);
  if (!parsedInput.success) {
    throw new AppError("INVALID_REQUEST");
  }
  const input = parsedInput.data;
  const identity: AnonymousReporterIdentity = resolveAnonymousReporterSession(
    request.cookieHeader,
    request.reporterHashSecret,
    { secure: request.secureCookie },
  );
  const result = await repository.submit(input, identity.reporterHash);

  return Object.freeze({ result, setCookie: identity.setCookie });
}
