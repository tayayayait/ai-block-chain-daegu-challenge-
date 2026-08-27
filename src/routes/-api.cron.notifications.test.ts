import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { DemoNotificationWorkerResult } from "@/lib/notifications/worker.server";
import {
  handleNotificationCronRequest,
  type NotificationCronHandlerDependencies,
} from "./api.cron.notifications";

const SECRET = "notification-route-cron-secret-123456";
const PUBLIC_ORIGIN = "https://app.onjung.example";

const completed = (
  overrides: Partial<Extract<DemoNotificationWorkerResult, { kind: "COMPLETED" }>> = {},
): Extract<DemoNotificationWorkerResult, { kind: "COMPLETED" }> => ({
  kind: "COMPLETED",
  claimed: 3,
  demoRecorded: 2,
  suppressed: 1,
  retryScheduled: 0,
  failedPermanent: 0,
  leaseLost: 0,
  ...overrides,
});

function dependencies(
  runAuthorizedWorker: NotificationCronHandlerDependencies["runAuthorizedWorker"],
  secret: string | null = SECRET,
): NotificationCronHandlerDependencies {
  return {
    getEnvironment: () => ({
      CRON_SECRET: secret ?? undefined,
      PUBLIC_APP_ORIGIN: PUBLIC_ORIGIN,
      NOTIFICATION_PROVIDER: "demo",
      NOTIFICATION_LIVE_SEND_ENABLED: false,
    }),
    runAuthorizedWorker,
  };
}

function request(authorization?: string): Request {
  return new Request(
    "https://onjung.example/api/cron/notifications",
    authorization ? { headers: { authorization } } : {},
  );
}

describe("GET /api/cron/notifications", () => {
  it("does not create fake delivery records when the production provider is disabled", async () => {
    const runAuthorizedWorker = vi.fn(async () => completed());
    const response = await handleNotificationCronRequest(request(`Bearer ${SECRET}`), {
      getEnvironment: () => ({
        CRON_SECRET: SECRET,
        PUBLIC_APP_ORIGIN: PUBLIC_ORIGIN,
        NOTIFICATION_PROVIDER: "disabled",
        NOTIFICATION_LIVE_SEND_ENABLED: false,
      }),
      runAuthorizedWorker,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "NOTIFICATION_NOT_CONFIGURED",
    });
    expect(runAuthorizedWorker).not.toHaveBeenCalled();
  });

  it("returns 401 before constructing a worker for missing or invalid bearers", async () => {
    const runAuthorizedWorker = vi.fn(async () => completed());

    for (const authorization of [undefined, "Bearer wrong-secret"]) {
      const response = await handleNotificationCronRequest(
        request(authorization),
        dependencies(runAuthorizedWorker),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
    }
    expect(runAuthorizedWorker).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is missing or too short", async () => {
    const runAuthorizedWorker = vi.fn(async () => completed());

    for (const secret of [null, "too-short"]) {
      const response = await handleNotificationCronRequest(
        request("Bearer too-short"),
        dependencies(runAuthorizedWorker, secret),
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        code: "CRON_NOT_CONFIGURED",
      });
    }
    expect(runAuthorizedWorker).not.toHaveBeenCalled();
  });

  it("returns only safe aggregate counts for a completed Demo run", async () => {
    const privateToken = "opaque-private-link-token";
    const runAuthorizedWorker = vi.fn(async () => completed());
    const response = await handleNotificationCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(runAuthorizedWorker),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(text)).toEqual({
      ok: true,
      summary: {
        claimed: 3,
        demoRecorded: 2,
        suppressed: 1,
        retryScheduled: 0,
        failedPermanent: 0,
        leaseLost: 0,
      },
    });
    expect(text).not.toMatch(new RegExp(`${privateToken}|010-|recipient|eventId`, "iu"));
    expect(runAuthorizedWorker).toHaveBeenCalledWith({
      publicOrigin: PUBLIC_ORIGIN,
      environment: {
        CRON_SECRET: SECRET,
        PUBLIC_APP_ORIGIN: PUBLIC_ORIGIN,
        NOTIFICATION_PROVIDER: "demo",
        NOTIFICATION_LIVE_SEND_ENABLED: false,
      },
    });
  });

  it("fails closed without a canonical PUBLIC_APP_ORIGIN and never derives it from the request", async () => {
    const runAuthorizedWorker = vi.fn(async () => completed());
    const response = await handleNotificationCronRequest(request(`Bearer ${SECRET}`), {
      getEnvironment: () => ({
        CRON_SECRET: SECRET,
        PUBLIC_APP_ORIGIN: undefined,
        NOTIFICATION_PROVIDER: "demo",
        NOTIFICATION_LIVE_SEND_ENABLED: false,
      }),
      runAuthorizedWorker,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "PUBLIC_ORIGIN_NOT_CONFIGURED",
    });
    expect(runAuthorizedWorker).not.toHaveBeenCalled();
  });

  it("maps an unavailable outbox and unexpected errors to non-sensitive responses", async () => {
    const unavailable = await handleNotificationCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(async () => ({ kind: "TEMPORARY_FAILURE", code: "OUTBOX_UNAVAILABLE" })),
    );
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      ok: false,
      code: "NOTIFICATION_OUTBOX_UNAVAILABLE",
    });

    const secretError = "database token=opaque guardian=010-1234-5678";
    const failed = await handleNotificationCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(async () => Promise.reject(new Error(secretError))),
    );
    const text = await failed.text();
    expect(failed.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ ok: false, code: "NOTIFICATION_WORKER_FAILED" });
    expect(text).not.toContain(secretError);
  });
});

describe("notification cron deployment contract", () => {
  it("preserves risk cron without scheduling a fake notification worker", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };

    expect(config.crons).toContainEqual({ path: "/api/cron/risk", schedule: "*/30 * * * *" });
    expect(config.crons).not.toContainEqual(
      expect.objectContaining({ path: "/api/cron/notifications" }),
    );
  });

  it("keeps the dormant demo worker server-only and out of production route composition", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "src/routes/api.cron.notifications.ts"),
      "utf8",
    );
    const runtimeSource = readFileSync(
      resolve(process.cwd(), "src/lib/notifications/runtime.server.ts"),
      "utf8",
    );
    const combined = `${routeSource}\n${runtimeSource}`;

    expect(routeSource).toContain('import "@tanstack/react-start/server-only"');
    expect(runtimeSource).toContain("createAdminSupabaseClient()");
    expect(runtimeSource).toContain("createSupabaseNotificationRepository");
    expect(runtimeSource).toContain("createSupabaseAlertRepository");
    expect(runtimeSource).toContain("createDemoNotificationProvider");
    expect(routeSource).not.toContain("runDemoNotificationRuntime");
    expect(combined).not.toMatch(
      /console\.(?:log|error)|twilio|solapi|sens|kakao.*message|SUPABASE_SECRET_KEY/iu,
    );
  });
});
