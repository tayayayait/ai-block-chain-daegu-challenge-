import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { AlertAccessRepository } from "@/lib/alerts/access-token.server";
import type {
  ClaimedGuardianAlert,
  NotificationFinalizeCommand,
  NotificationRepository,
} from "./repository.server";
import {
  createNotificationDeepLinkIssuer,
  isNotificationCronAuthorized,
  NotificationRuntimeError,
  runDemoNotificationRuntime,
} from "./runtime.server";

const ALERT_ID = "123e4567-e89b-42d3-a456-426614174000";
const EVENT_ID = "123e4567-e89b-42d3-a456-426614174001";
const LEASE_UNTIL = "2026-08-24T00:01:00.000Z";
const NOW = new Date("2026-08-24T00:00:00.000Z");
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174004";

const claimedAlert: ClaimedGuardianAlert = {
  alertId: ALERT_ID,
  eventId: EVENT_ID,
  recipientRef: "a".repeat(64),
  channel: "SMS",
  templateKey: "HEAT_L3",
  riskLevel: "L3",
  idempotencyKey: "subject:episode:L3:ENTER",
  attemptCount: 1,
  leaseUntil: LEASE_UNTIL,
  claimToken: CLAIM_TOKEN,
  consentRevision: 3,
};

function createAlertAccessRepository() {
  const grants: Parameters<AlertAccessRepository["saveGrant"]>[0][] = [];
  const repository: AlertAccessRepository = {
    saveGrant: async (grant) => {
      grants.push(grant);
    },
    consumeOnceAndCreateSession: async () => false,
    findValidSession: async () => null,
  };
  return { repository, grants };
}

function createNotificationRepository() {
  const finalizations: NotificationFinalizeCommand[] = [];
  let claimed = true;
  const repository: NotificationRepository = {
    claim: async () => {
      if (!claimed) return [];
      claimed = false;
      return [claimedAlert];
    },
    recheckEligibility: async () => ({ kind: "ELIGIBLE" }),
    finalize: async (command) => {
      finalizations.push(command);
      return { disposition: "APPLIED", status: command.outcome.kind };
    },
  };
  return { repository, finalizations };
}

describe("notification worker runtime", () => {
  it("issues a 256-bit one-time grant while persisting only its SHA-256 hash", async () => {
    const access = createAlertAccessRepository();
    const issuer = createNotificationDeepLinkIssuer({
      repository: access.repository,
      publicOrigin: "https://onjung.example",
      now: () => NOW,
      randomBytes: () => new Uint8Array(32).fill(7),
    });

    const deepLink = await issuer.issue({
      alertId: ALERT_ID,
      eventId: EVENT_ID,
      claimToken: CLAIM_TOKEN,
      expectedLeaseUntil: LEASE_UNTIL,
    });
    const url = new URL(deepLink);
    const token = url.searchParams.get("token");

    expect(url.origin).toBe("https://onjung.example");
    expect(url.pathname).toBe(`/alert/${EVENT_ID}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(access.grants).toEqual([
      {
        alertId: ALERT_ID,
        eventId: EVENT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: new Date(LEASE_UNTIL),
        tokenHash: createHash("sha256")
          .update(token ?? "")
          .digest("hex"),
        expiresAt: new Date("2026-08-25T00:00:00.000Z"),
      },
    ]);
    expect(JSON.stringify(access.grants)).not.toContain(token);
  });

  it("composes the durable outbox with the no-network Demo provider", async () => {
    const outbox = createNotificationRepository();
    const access = createAlertAccessRepository();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await runDemoNotificationRuntime({
      publicOrigin: "https://onjung.example",
      environment: {
        NOTIFICATION_PROVIDER: "demo",
        NOTIFICATION_LIVE_SEND_ENABLED: false,
      },
      notificationRepository: outbox.repository,
      alertAccessRepository: access.repository,
      now: () => NOW,
      random: () => 0,
      randomBytes: () => new Uint8Array(32).fill(9),
      limit: 10,
    });

    expect(result).toEqual({
      kind: "COMPLETED",
      claimed: 1,
      demoRecorded: 1,
      suppressed: 0,
      retryScheduled: 0,
      failedPermanent: 0,
      leaseLost: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(access.grants).toHaveLength(1);
    expect(outbox.finalizations).toEqual([
      {
        alertId: ALERT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: LEASE_UNTIL,
        outcome: {
          kind: "DEMO_RECORDED",
          providerMessageId: expect.stringMatching(/^demo_[0-9a-f]{64}$/u),
          recordedAt: NOW.toISOString(),
        },
      },
    ]);
    expect(JSON.stringify([result, access.grants, outbox.finalizations])).not.toMatch(
      /\?token=|010-|accepted|delivered|alert_sent/iu,
    );
    fetchSpy.mockRestore();
  });

  it("fails closed for every live-send or non-demo configuration", async () => {
    const outbox = createNotificationRepository();
    const access = createAlertAccessRepository();

    for (const environment of [
      { NOTIFICATION_PROVIDER: "sms", NOTIFICATION_LIVE_SEND_ENABLED: false },
      { NOTIFICATION_PROVIDER: "demo", NOTIFICATION_LIVE_SEND_ENABLED: true },
    ]) {
      await expect(
        runDemoNotificationRuntime({
          publicOrigin: "https://onjung.example",
          environment,
          notificationRepository: outbox.repository,
          alertAccessRepository: access.repository,
        }),
      ).rejects.toBeInstanceOf(NotificationRuntimeError);
    }
    expect(access.grants).toHaveLength(0);
    expect(outbox.finalizations).toHaveLength(0);
  });

  it("allows HTTPS origins and loopback development only", async () => {
    const access = createAlertAccessRepository();

    for (const origin of [
      "http://example.com",
      "javascript:alert(1)",
      "https://user:password@example.com",
    ]) {
      expect(() =>
        createNotificationDeepLinkIssuer({ repository: access.repository, publicOrigin: origin }),
      ).toThrow(NotificationRuntimeError);
    }

    expect(() =>
      createNotificationDeepLinkIssuer({
        repository: access.repository,
        publicOrigin: "http://localhost:3000",
      }),
    ).not.toThrow();
  });
});

describe("notification cron authorization", () => {
  it("uses an exact bearer secret and rejects malformed or short inputs", () => {
    const secret = "notification-cron-secret-123456";

    expect(isNotificationCronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(isNotificationCronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isNotificationCronAuthorized(`Basic ${secret}`, secret)).toBe(false);
    expect(isNotificationCronAuthorized(undefined, secret)).toBe(false);
    expect(isNotificationCronAuthorized("Bearer too-short", "too-short")).toBe(false);
  });
});
