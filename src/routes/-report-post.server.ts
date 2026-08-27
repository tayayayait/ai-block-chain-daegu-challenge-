import "@tanstack/react-start/server-only";

import { z } from "zod";

import { AppError } from "@/lib/error-dto";
import type { AnonymousReportResponse } from "@/lib/reports/service.server";
import { ShelterReportInputSchema } from "@/lib/reports/report-input";

export type ShelterReportRouteOperations = Readonly<{
  submit(
    request: Request,
    input: z.infer<typeof ShelterReportInputSchema>,
  ): Promise<AnonymousReportResponse>;
}>;

const productionOperations: ShelterReportRouteOperations = {
  async submit(request, input) {
    const [{ getServerEnv }, { submitAnonymousShelterReport }] = await Promise.all([
      import("@/lib/env.server"),
      import("@/lib/reports/service.server"),
    ]);
    const environment = getServerEnv();
    if (!environment.REPORTER_HASH_SECRET) throw new AppError("SERVER_TEMPORARY");

    return submitAnonymousShelterReport({
      input,
      cookieHeader: request.headers.get("cookie"),
      reporterHashSecret: environment.REPORTER_HASH_SECRET,
      secureCookie: new URL(request.url).protocol === "https:",
    });
  },
};

function reportJson(body: unknown, status: number, setCookie: string | null = null): Response {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
  });
  if (setCookie !== null) headers.set("Set-Cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function formText(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

export async function handleShelterReportPostRequest(
  request: Request,
  operations: ShelterReportRouteOperations = productionOperations,
  expectedShelterId?: string,
): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reportJson({ ok: false, code: "INVALID_REQUEST" }, 400);
  }

  const raw = {
    shelterId: formText(form, "shelterId"),
    isOpen: formText(form, "isOpen"),
    crowd: formText(form, "crowd"),
    clientRequestId: formText(form, "clientRequestId"),
  };
  const parsed = ShelterReportInputSchema.safeParse(raw);
  if (
    !parsed.success ||
    (expectedShelterId !== undefined && parsed.data.shelterId !== expectedShelterId)
  ) {
    return reportJson({ ok: false, code: "INVALID_REQUEST" }, 400);
  }

  try {
    const response = await operations.submit(request, parsed.data);
    return reportJson({ ok: true, result: response.result }, 200, response.setCookie);
  } catch (error) {
    const code = error instanceof AppError ? error.code : "SERVER_TEMPORARY";
    const status = code === "INVALID_REQUEST" ? 400 : code === "NOT_FOUND" ? 404 : 503;
    return reportJson({ ok: false, code }, status);
  }
}
