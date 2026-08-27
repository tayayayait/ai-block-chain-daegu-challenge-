import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { getServerEnv } from "@/lib/env.server";
import {
  ATTESTATION_CRON_SECRET_MIN_LENGTH,
  AttestationRuntimeError,
  createProductionAttestationRuntime,
  isAttestationCronAuthorized,
} from "@/lib/attestation/runtime.server";
import type { AttestationWorkerResult } from "@/lib/attestation/worker.server";

export interface AttestationCronHandlerDependencies {
  readonly getCronSecret: () => string | undefined;
  readonly now: () => Date;
  readonly runWorker: (now: Date) => Promise<AttestationWorkerResult>;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

const SafeSummarySchema = z
  .object({
    claimed: z.number().int().min(0).max(100),
    verified: z.number().int().min(0).max(100),
    retryScheduled: z.number().int().min(0).max(100),
    failed: z.number().int().min(0).max(100),
    leaseLost: z.number().int().min(0).max(100),
    finalizeFailed: z.number().int().min(0).max(100),
  })
  .strict()
  .refine(
    (summary) =>
      summary.verified +
        summary.retryScheduled +
        summary.failed +
        summary.leaseLost +
        summary.finalizeFailed ===
      summary.claimed,
  );

function safeSummary(result: Extract<AttestationWorkerResult, { kind: "COMPLETED" }>) {
  return Object.freeze(
    SafeSummarySchema.parse({
      claimed: result.claimed,
      verified: result.verified,
      retryScheduled: result.retryScheduled,
      failed: result.failed,
      leaseLost: result.leaseLost,
      finalizeFailed: result.finalizeFailed,
    }),
  );
}

const productionDependencies: AttestationCronHandlerDependencies = {
  getCronSecret: () => getServerEnv().CRON_SECRET,
  now: () => new Date(),
  runWorker: (now) => createProductionAttestationRuntime({ now: () => now }).run(),
};

/** Vercel Cron invokes this GET handler with `Authorization: Bearer <CRON_SECRET>`. */
export async function handleAttestationCronRequest(
  request: Request,
  dependencies: AttestationCronHandlerDependencies = productionDependencies,
): Promise<Response> {
  let cronSecret: string | undefined;
  try {
    cronSecret = dependencies.getCronSecret();
  } catch {
    return jsonResponse({ ok: false, code: "CRON_NOT_CONFIGURED" }, 503);
  }

  if (!cronSecret || cronSecret.length < ATTESTATION_CRON_SECRET_MIN_LENGTH) {
    return jsonResponse({ ok: false, code: "CRON_NOT_CONFIGURED" }, 503);
  }
  if (!isAttestationCronAuthorized(request.headers.get("authorization"), cronSecret)) {
    return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
  }

  try {
    const result = await dependencies.runWorker(dependencies.now());
    if (result.kind === "TEMPORARY_FAILURE") {
      return jsonResponse({ ok: false, code: "ATTESTATION_OUTBOX_UNAVAILABLE" }, 503);
    }
    return jsonResponse({ ok: true, summary: safeSummary(result) }, 200);
  } catch (error) {
    if (error instanceof AttestationRuntimeError) {
      return jsonResponse({ ok: false, code: "ATTESTATION_NOT_CONFIGURED" }, 503);
    }
    return jsonResponse({ ok: false, code: "ATTESTATION_WORKER_FAILED" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/attestations")({
  server: {
    handlers: {
      GET: ({ request }) => handleAttestationCronRequest(request),
    },
  },
});
