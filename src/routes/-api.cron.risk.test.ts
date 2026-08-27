import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { KmaClient } from "@/integrations/kma/kma.server";
import type { RiskBatchSummary } from "@/lib/risk/recompute-risk.batch";
import {
  createRunMemoizedKmaClient,
  handleRiskCronRequest,
  type RiskCronHandlerDependencies,
} from "./api.cron.risk";

const SECRET = "route-fixture-cron-secret-123456";
const NOW = new Date("2026-08-23T12:00:00.000Z");

function summary(overrides: Partial<RiskBatchSummary> = {}): RiskBatchSummary {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    status: "COMPLETED",
    startedAt: NOW.toISOString(),
    finishedAt: "2026-08-23T12:00:05.000Z",
    totalSubjects: 5,
    succeededSubjects: 5,
    failedSubjects: 0,
    duplicateSnapshots: 0,
    transitionCount: 2,
    failedSubjectIds: [],
    ...overrides,
  };
}

function dependencies(
  runAuthorizedBatch: RiskCronHandlerDependencies["runAuthorizedBatch"],
  cronSecret: string | undefined,
): RiskCronHandlerDependencies {
  return {
    getCronSecret: () => cronSecret,
    now: () => NOW,
    runAuthorizedBatch,
  };
}

function request(authorization?: string): Request {
  return new Request(
    "https://onjung.example/api/cron/risk",
    authorization ? { headers: { authorization } } : {},
  );
}

describe("GET /api/cron/risk", () => {
  it("returns 401 before creating batch dependencies for a missing or invalid bearer", async () => {
    const runAuthorizedBatch = vi.fn(async () => summary());

    for (const authorization of [undefined, "Bearer wrong-secret"]) {
      const response = await handleRiskCronRequest(
        request(authorization),
        dependencies(runAuthorizedBatch, SECRET),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
    }
    expect(runAuthorizedBatch).not.toHaveBeenCalled();
  });

  it("returns a distinct 409 response when a live database lease owns the batch", async () => {
    const runAuthorizedBatch = vi.fn(async () =>
      summary({
        status: "SKIPPED_LOCKED",
        totalSubjects: 0,
        succeededSubjects: 0,
        transitionCount: 0,
      }),
    );

    const response = await handleRiskCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(runAuthorizedBatch, SECRET),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      ok: false,
      code: "RISK_BATCH_LOCKED",
      summary: { status: "SKIPPED_LOCKED", failedSubjects: 0 },
    });
  });

  it("returns the safe execution summary and omits failed subject identifiers", async () => {
    const failedSubjectId = "10000000-0000-4000-8000-000000000005";
    const runAuthorizedBatch = vi.fn(async () =>
      summary({
        status: "PARTIAL",
        succeededSubjects: 4,
        failedSubjects: 1,
        failedSubjectIds: [failedSubjectId],
      }),
    );

    const response = await handleRiskCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(runAuthorizedBatch, SECRET),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      summary: { status: "PARTIAL", succeededSubjects: 4, failedSubjects: 1 },
    });
    expect(text).not.toContain(failedSubjectId);
  });

  it("returns a safe 503 when CRON_SECRET is not configured", async () => {
    const runAuthorizedBatch = vi.fn(async () => summary());
    const response = await handleRiskCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(runAuthorizedBatch, undefined),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "CRON_NOT_CONFIGURED",
    });
    expect(runAuthorizedBatch).not.toHaveBeenCalled();
  });

  it("fails closed for a configured CRON_SECRET shorter than the deployment minimum", async () => {
    const weakSecret = "too-short";
    const runAuthorizedBatch = vi.fn(async () => summary());
    const response = await handleRiskCronRequest(
      request(`Bearer ${weakSecret}`),
      dependencies(runAuthorizedBatch, weakSecret),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "CRON_NOT_CONFIGURED",
    });
    expect(runAuthorizedBatch).not.toHaveBeenCalled();
  });

  it("never returns raw database or provider errors", async () => {
    const secretError = "PROVIDER_RESPONSE_WITH_SECRET";
    const response = await handleRiskCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(
        vi.fn(async () => Promise.reject(new Error(secretError))),
        SECRET,
      ),
    );
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ ok: false, code: "RISK_BATCH_FAILED" });
    expect(text).not.toContain(secretError);
  });
});

describe("risk cron deployment contract", () => {
  it("schedules the protected GET endpoint every 30 minutes", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as unknown;

    expect(config).toMatchObject({ crons: expect.any(Array) });
    expect((config as { crons: unknown[] }).crons).toContainEqual({
      path: "/api/cron/risk",
      schedule: "*/30 * * * *",
    });
  });

  it("keeps the admin client and weather refresh inside the server-only route", () => {
    const source = readFileSync(resolve(process.cwd(), "src/routes/api.cron.risk.ts"), "utf8");

    expect(source).toContain('import "@tanstack/react-start/server-only"');
    expect(source).toContain("createAdminSupabaseClient()");
    expect(source).toContain("createDefaultKmaClient()");
    expect(source).toContain("createWeatherService({");
    expect(source).toContain("createSupabaseRiskBatchRepository({");
    expect(source).not.toMatch(/console\.(?:log|error)|SUPABASE_SECRET_KEY/iu);
  });
});

describe("risk cron KMA request budget", () => {
  it("memoizes point cells, fallback grids, and the global warning inside one run", async () => {
    const getPointObservations = vi.fn(async () => []);
    const getCurrentHeatWarnings = vi.fn(async () => []);
    const getVillageForecast = vi.fn(async () => []);
    const client: KmaClient = {
      getPointObservations,
      getCurrentHeatWarnings,
      getVillageForecast,
    };
    const memoized = createRunMemoizedKmaClient(client);
    const at = "2026-08-23T21:00:00+09:00";

    await Promise.all([
      memoized.getPointObservations({ longitude: 128.60123, latitude: 35.87111, at }),
      memoized.getPointObservations({ longitude: 128.60123, latitude: 35.87111, at }),
      memoized.getCurrentHeatWarnings(at),
      memoized.getCurrentHeatWarnings(at),
      memoized.getVillageForecast({ nx: 89, ny: 90, at }),
      memoized.getVillageForecast({ nx: 89, ny: 90, at }),
    ]);
    await memoized.getPointObservations({ longitude: 128.62, latitude: 35.88, at });

    expect(getPointObservations).toHaveBeenCalledTimes(2);
    expect(getCurrentHeatWarnings).toHaveBeenCalledOnce();
    expect(getVillageForecast).toHaveBeenCalledOnce();
  });
});
