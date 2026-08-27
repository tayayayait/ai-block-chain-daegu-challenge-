import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { getServerEnv } from "@/lib/env.server";
import {
  isNotificationCronAuthorized,
  NOTIFICATION_CRON_SECRET_MIN_LENGTH,
} from "@/lib/notifications/cron-auth.server";
import { normalizeNotificationPublicOrigin } from "@/lib/notifications/runtime.server";
import type { DemoNotificationWorkerResult } from "@/lib/notifications/worker.server";

interface NotificationCronEnvironment {
  readonly CRON_SECRET: string | undefined;
  readonly PUBLIC_APP_ORIGIN: string | undefined;
  readonly NOTIFICATION_PROVIDER: unknown;
  readonly NOTIFICATION_LIVE_SEND_ENABLED: unknown;
}

export interface NotificationCronHandlerDependencies {
  readonly getEnvironment: () => NotificationCronEnvironment;
  readonly runAuthorizedWorker: (input: {
    readonly publicOrigin: string;
    readonly environment: NotificationCronEnvironment;
  }) => Promise<DemoNotificationWorkerResult>;
}

const productionDependencies: NotificationCronHandlerDependencies = {
  getEnvironment: () => {
    const environment = getServerEnv();
    return {
      CRON_SECRET: environment.CRON_SECRET,
      PUBLIC_APP_ORIGIN: environment.PUBLIC_APP_ORIGIN,
      NOTIFICATION_PROVIDER: environment.NOTIFICATION_PROVIDER,
      NOTIFICATION_LIVE_SEND_ENABLED: environment.NOTIFICATION_LIVE_SEND_ENABLED,
    };
  },
  runAuthorizedWorker: async () => {
    throw new Error("NOTIFICATION_PROVIDER_NOT_CONFIGURED");
  },
};

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function safeSummary(result: Extract<DemoNotificationWorkerResult, { kind: "COMPLETED" }>) {
  return Object.freeze({
    claimed: result.claimed,
    demoRecorded: result.demoRecorded,
    suppressed: result.suppressed,
    retryScheduled: result.retryScheduled,
    failedPermanent: result.failedPermanent,
    leaseLost: result.leaseLost,
  });
}

/** Vercel Cron invokes this GET handler with `Authorization: Bearer ${CRON_SECRET}`. */
export async function handleNotificationCronRequest(
  request: Request,
  dependencies: NotificationCronHandlerDependencies = productionDependencies,
): Promise<Response> {
  let environment: NotificationCronEnvironment;
  try {
    environment = dependencies.getEnvironment();
  } catch {
    return jsonResponse({ ok: false, code: "CRON_NOT_CONFIGURED" }, 503);
  }

  const cronSecret = environment.CRON_SECRET;
  if (!cronSecret || cronSecret.length < NOTIFICATION_CRON_SECRET_MIN_LENGTH) {
    return jsonResponse({ ok: false, code: "CRON_NOT_CONFIGURED" }, 503);
  }

  if (environment.NOTIFICATION_PROVIDER === "disabled") {
    return jsonResponse({ ok: false, code: "NOTIFICATION_NOT_CONFIGURED" }, 503);
  }

  if (!isNotificationCronAuthorized(request.headers.get("authorization"), cronSecret)) {
    return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
  }

  let publicOrigin: string;
  try {
    if (!environment.PUBLIC_APP_ORIGIN) throw new Error("missing public origin");
    publicOrigin = normalizeNotificationPublicOrigin(environment.PUBLIC_APP_ORIGIN);
  } catch {
    return jsonResponse({ ok: false, code: "PUBLIC_ORIGIN_NOT_CONFIGURED" }, 503);
  }

  try {
    const result = await dependencies.runAuthorizedWorker({ publicOrigin, environment });
    if (result.kind === "TEMPORARY_FAILURE") {
      return jsonResponse({ ok: false, code: "NOTIFICATION_OUTBOX_UNAVAILABLE" }, 503);
    }
    return jsonResponse({ ok: true, summary: safeSummary(result) }, 200);
  } catch {
    return jsonResponse({ ok: false, code: "NOTIFICATION_WORKER_FAILED" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/notifications")({
  server: {
    handlers: {
      GET: ({ request }) => handleNotificationCronRequest(request),
    },
  },
});
