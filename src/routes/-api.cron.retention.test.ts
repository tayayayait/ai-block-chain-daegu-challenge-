import { describe, expect, it, vi } from "vitest";

import { handleRetentionCronRequest } from "./api.cron.retention";

const SECRET = "retention-route-fixture-secret";
const request = (authorization?: string) =>
  new Request(
    "https://onjung.example/api/cron/retention",
    authorization ? { headers: { Authorization: authorization } } : {},
  );

describe("retention cron route", () => {
  it("returns a fixed 503 when the cron secret is not configured", async () => {
    const runWorker = vi.fn();
    const response = await handleRetentionCronRequest(request(), {
      getCronSecret: () => undefined,
      now: () => new Date("2026-08-24T08:00:00.000Z"),
      runWorker,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "CRON_NOT_CONFIGURED" });
    expect(runWorker).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated calls before invoking the worker", async () => {
    const runWorker = vi.fn();
    const response = await handleRetentionCronRequest(request(), {
      getCronSecret: () => SECRET,
      now: () => new Date("2026-08-24T08:00:00.000Z"),
      runWorker,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(runWorker).not.toHaveBeenCalled();
  });

  it("returns only bounded counters for an authorized completed run", async () => {
    const response = await handleRetentionCronRequest(request(`Bearer ${SECRET}`), {
      getCronSecret: () => SECRET,
      now: () => new Date("2026-08-24T08:00:00.000Z"),
      runWorker: vi.fn(async () => ({
        kind: "COMPLETED" as const,
        database: {
          access_tokens: 1,
          access_sessions: 0,
          route_cache: 2,
          medication_api_cache: 3,
          guardian_alerts: 0,
          attestation_jobs: 0,
          risk_recompute_queue: 1,
        },
        imageClaimed: 2,
        imageDeleted: 1,
        imageRetryScheduled: 1,
        imageLeaseLost: 0,
        imageFinalizeFailed: 0,
      })),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      summary: { imageDeleted: 1, imageRetryScheduled: 1 },
    });
  });

  it("maps a temporary repository outage to a stable 503", async () => {
    const response = await handleRetentionCronRequest(request(`Bearer ${SECRET}`), {
      getCronSecret: () => SECRET,
      now: () => new Date("2026-08-24T08:00:00.000Z"),
      runWorker: vi.fn(async () => ({
        kind: "TEMPORARY_FAILURE" as const,
        code: "RETENTION_DATABASE_UNAVAILABLE" as const,
      })),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "RETENTION_DATABASE_UNAVAILABLE",
    });
  });

  it("maps an unexpected worker failure without exposing its message", async () => {
    const response = await handleRetentionCronRequest(request(`Bearer ${SECRET}`), {
      getCronSecret: () => SECRET,
      now: () => new Date("2026-08-24T08:00:00.000Z"),
      runWorker: vi.fn(async () => {
        throw new Error("PRIVATE_STORAGE_DIAGNOSTIC");
      }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ ok: false, code: "RETENTION_WORKER_FAILED" });
    expect(JSON.stringify(body)).not.toContain("PRIVATE_STORAGE_DIAGNOSTIC");
  });
});
