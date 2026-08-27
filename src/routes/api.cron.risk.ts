import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { createDefaultKmaClient, type KmaClient } from "@/integrations/kma/kma.server";
import { createWeatherRepository } from "@/integrations/kma/weather-repository.server";
import { createWeatherService } from "@/integrations/kma/weather-service.server";
import { getServerEnv } from "@/lib/env.server";
import {
  isRiskCronAuthorized,
  RISK_CRON_SECRET_MIN_LENGTH,
  runRiskBatch,
  type RiskBatchSummary,
} from "@/lib/risk/recompute-risk.batch";
import { createSupabaseRiskBatchRepository } from "@/lib/risk/supabase-risk-repository.server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";

export interface RiskCronHandlerDependencies {
  readonly getCronSecret: () => string | undefined;
  readonly now: () => Date;
  readonly runAuthorizedBatch: (input: {
    readonly authorizationHeader: string;
    readonly cronSecret: string;
    readonly computedAt: Date;
  }) => Promise<RiskBatchSummary>;
}

type PublicRiskBatchSummary = Omit<RiskBatchSummary, "failedSubjectIds">;

function publicSummary(summary: RiskBatchSummary): PublicRiskBatchSummary {
  const { failedSubjectIds: _privateFailedSubjectIds, ...safe } = summary;
  return safe;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function memoizedRequest<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  request: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = request();
  cache.set(key, pending);
  return pending;
}

/** Keeps one batch inside the documented KMA cell/grid/global-warning call budget. */
export function createRunMemoizedKmaClient(client: KmaClient): KmaClient {
  const points = new Map<string, ReturnType<KmaClient["getPointObservations"]>>();
  const warnings = new Map<string, ReturnType<KmaClient["getCurrentHeatWarnings"]>>();
  const forecasts = new Map<string, ReturnType<KmaClient["getVillageForecast"]>>();

  return {
    getPointObservations: (input) =>
      memoizedRequest(points, `${input.longitude}:${input.latitude}:${input.at}`, () =>
        client.getPointObservations(input),
      ),
    getCurrentHeatWarnings: (at) =>
      memoizedRequest(warnings, at, () => client.getCurrentHeatWarnings(at)),
    getVillageForecast: (input) =>
      memoizedRequest(forecasts, `${input.nx}:${input.ny}:${input.at}`, () =>
        client.getVillageForecast(input),
      ),
  };
}

async function runProductionBatch(input: {
  readonly authorizationHeader: string;
  readonly cronSecret: string;
  readonly computedAt: Date;
}): Promise<RiskBatchSummary> {
  const adminClient = createAdminSupabaseClient();
  const weatherService = createWeatherService({
    kmaClient: createRunMemoizedKmaClient(createDefaultKmaClient()),
    repository: createWeatherRepository(adminClient),
    clock: { now: () => input.computedAt },
  });
  const repository = createSupabaseRiskBatchRepository({
    client: adminClient,
    weatherResolver: weatherService,
  });

  return runRiskBatch({
    authorizationHeader: input.authorizationHeader,
    cronSecret: input.cronSecret,
    computedAt: input.computedAt,
    repository,
  });
}

const productionDependencies: RiskCronHandlerDependencies = {
  getCronSecret: () => getServerEnv().CRON_SECRET,
  now: () => new Date(),
  runAuthorizedBatch: runProductionBatch,
};

/** Vercel Cron invokes this GET handler with `Authorization: Bearer ${CRON_SECRET}`. */
export async function handleRiskCronRequest(
  request: Request,
  dependencies: RiskCronHandlerDependencies = productionDependencies,
): Promise<Response> {
  let cronSecret: string | undefined;
  try {
    cronSecret = dependencies.getCronSecret();
  } catch {
    return jsonResponse({ ok: false, code: "CRON_NOT_CONFIGURED" }, 503);
  }

  if (!cronSecret || cronSecret.length < RISK_CRON_SECRET_MIN_LENGTH) {
    return jsonResponse({ ok: false, code: "CRON_NOT_CONFIGURED" }, 503);
  }

  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader === null || !isRiskCronAuthorized(authorizationHeader, cronSecret)) {
    return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
  }

  try {
    const summary = await dependencies.runAuthorizedBatch({
      authorizationHeader,
      cronSecret,
      computedAt: dependencies.now(),
    });
    const safeSummary = publicSummary(summary);
    if (summary.status === "SKIPPED_LOCKED") {
      return jsonResponse({ ok: false, code: "RISK_BATCH_LOCKED", summary: safeSummary }, 409);
    }
    return jsonResponse({ ok: true, summary: safeSummary }, 200);
  } catch {
    return jsonResponse({ ok: false, code: "RISK_BATCH_FAILED" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/risk")({
  server: {
    handlers: {
      GET: ({ request }) => handleRiskCronRequest(request),
    },
  },
});
