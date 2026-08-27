import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { getServerEnv } from "@/lib/env.server";
import {
  isRetentionCronAuthorized,
  RETENTION_CRON_SECRET_MIN_LENGTH,
  runProductionRetentionWorker,
} from "@/lib/retention/runtime.server";
import type { RetentionWorkerResult } from "@/lib/retention/worker.server";

export interface RetentionCronHandlerDependencies {
  readonly getCronSecret: () => string | undefined;
  readonly now: () => Date;
  readonly runWorker: (now: Date) => Promise<RetentionWorkerResult>;
}

const productionDependencies: RetentionCronHandlerDependencies = {
  getCronSecret: () => getServerEnv().CRON_SECRET,
  now: () => new Date(),
  runWorker: runProductionRetentionWorker,
};

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function handleRetentionCronRequest(
  request: Request,
  dependencies: RetentionCronHandlerDependencies = productionDependencies,
): Promise<Response> {
  let cronSecret: string | undefined;
  try {
    cronSecret = dependencies.getCronSecret();
  } catch {
    return jsonResponse({ ok: false, code: "CRON_NOT_CONFIGURED" }, 503);
  }
  if (!cronSecret || cronSecret.length < RETENTION_CRON_SECRET_MIN_LENGTH) {
    return jsonResponse({ ok: false, code: "CRON_NOT_CONFIGURED" }, 503);
  }
  if (!isRetentionCronAuthorized(request.headers.get("authorization"), cronSecret)) {
    return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
  }

  try {
    const result = await dependencies.runWorker(dependencies.now());
    if (result.kind === "TEMPORARY_FAILURE") {
      return jsonResponse({ ok: false, code: result.code }, 503);
    }
    return jsonResponse(
      {
        ok: true,
        summary: {
          database: result.database,
          imageClaimed: result.imageClaimed,
          imageDeleted: result.imageDeleted,
          imageRetryScheduled: result.imageRetryScheduled,
          imageLeaseLost: result.imageLeaseLost,
          imageFinalizeFailed: result.imageFinalizeFailed,
        },
      },
      200,
    );
  } catch {
    return jsonResponse({ ok: false, code: "RETENTION_WORKER_FAILED" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/retention")({
  server: {
    handlers: {
      GET: ({ request }) => handleRetentionCronRequest(request),
    },
  },
});
