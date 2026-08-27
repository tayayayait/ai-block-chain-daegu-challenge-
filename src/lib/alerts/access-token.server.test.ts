import { describe, expect, it } from "vitest";

import {
  ALERT_ACCESS_TTL_MS,
  createAlertAccessGrant,
  exchangeAlertAccessToken,
  readAlertSessionAccessToken,
  resolveAlertAccessSession,
  resolveAlertSubjectSession,
  resolveAlertSubjectSessionToken,
  type AlertAccessRepository,
  type AlertSubjectSessionRepository,
} from "./access-token.server";

const ALERT_ID = "123e4567-e89b-42d3-a456-426614174000";
const EVENT_ID = "123e4567-e89b-42d3-a456-426614174001";
const SUBJECT_ID = "123e4567-e89b-42d3-a456-426614174002";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174003";
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174004";

const createRepository = (): AlertAccessRepository & {
  consumed: Set<string>;
  sessions: Map<string, { alertId: string; eventId: string; expiresAt: Date }>;
} => {
  const grants = new Map<string, { alertId: string; eventId: string; expiresAt: Date }>();
  const consumed = new Set<string>();
  const sessions = new Map<string, { alertId: string; eventId: string; expiresAt: Date }>();
  return {
    consumed,
    sessions,
    saveGrant: async (grant) => {
      grants.set(grant.tokenHash, {
        alertId: grant.alertId,
        eventId: grant.eventId,
        expiresAt: grant.expiresAt,
      });
    },
    consumeOnceAndCreateSession: async (input) => {
      const grant = grants.get(input.tokenHash);
      if (
        !grant ||
        grant.eventId !== input.eventId ||
        grant.expiresAt <= input.now ||
        consumed.has(input.tokenHash)
      ) {
        return false;
      }
      consumed.add(input.tokenHash);
      sessions.set(input.sessionHash, {
        alertId: grant.alertId,
        eventId: grant.eventId,
        expiresAt: input.sessionExpiresAt,
      });
      return true;
    },
    findValidSession: async ({ sessionHash, eventId, now }) => {
      const session = sessions.get(sessionHash);
      if (!session || session.eventId !== eventId || session.expiresAt <= now) return null;
      return { alertId: session.alertId, eventId: session.eventId };
    },
  };
};

describe("one-time alert access token", () => {
  it("stores only a 256-bit token hash with a 24-hour expiry", async () => {
    const repository = createRepository();
    const now = new Date("2026-08-23T00:00:00.000Z");
    const grant = await createAlertAccessGrant({
      alertId: ALERT_ID,
      eventId: EVENT_ID,
      claimToken: CLAIM_TOKEN,
      expectedLeaseUntil: new Date(now.getTime() + 4 * 60_000),
      repository,
      now: () => now,
      randomBytes: () => Uint8Array.from({ length: 32 }, (_, index) => index),
    });

    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(grant.expiresAt.getTime()).toBe(now.getTime() + ALERT_ACCESS_TTL_MS);
    expect(JSON.stringify([...repository.consumed])).not.toContain(grant.token);
  });

  it("consumes the token once, issues an HttpOnly session and rejects reuse generically", async () => {
    const repository = createRepository();
    const now = new Date("2026-08-23T00:00:00.000Z");
    const grant = await createAlertAccessGrant({
      alertId: ALERT_ID,
      eventId: EVENT_ID,
      claimToken: CLAIM_TOKEN,
      expectedLeaseUntil: new Date(now.getTime() + 4 * 60_000),
      repository,
      now: () => now,
    });

    const first = await exchangeAlertAccessToken({
      eventId: EVENT_ID,
      token: grant.token,
      repository,
      now: () => now,
    });
    expect(first.kind).toBe("SUCCESS");
    if (first.kind !== "SUCCESS") throw new Error("expected access session");
    expect(first.setCookie).toMatch(/^__Host-onjung-alert=/);
    expect(first.setCookie).toMatch(/; HttpOnly; Secure; SameSite=Lax; Path=\//);
    expect(first.setCookie).not.toContain(grant.token);

    await expect(
      exchangeAlertAccessToken({
        eventId: EVENT_ID,
        token: grant.token,
        repository,
        now: () => now,
      }),
    ).resolves.toEqual({ kind: "INVALID_OR_EXPIRED" });
  });

  it("rejects an event mismatch and resolves only the matching unexpired session cookie", async () => {
    const repository = createRepository();
    const now = new Date("2026-08-23T00:00:00.000Z");
    const grant = await createAlertAccessGrant({
      alertId: ALERT_ID,
      eventId: EVENT_ID,
      claimToken: CLAIM_TOKEN,
      expectedLeaseUntil: new Date(now.getTime() + 4 * 60_000),
      repository,
      now: () => now,
    });

    await expect(
      exchangeAlertAccessToken({
        eventId: "123e4567-e89b-42d3-a456-426614174099",
        token: grant.token,
        repository,
        now: () => now,
      }),
    ).resolves.toEqual({ kind: "INVALID_OR_EXPIRED" });

    const exchange = await exchangeAlertAccessToken({
      eventId: EVENT_ID,
      token: grant.token,
      repository,
      now: () => now,
    });
    if (exchange.kind !== "SUCCESS") throw new Error("expected access session");
    const cookieHeader = exchange.setCookie.split(";", 1)[0] ?? "";
    await expect(
      resolveAlertAccessSession({
        eventId: EVENT_ID,
        cookieHeader,
        repository,
        now: () => new Date(now.getTime() + 1_000),
      }),
    ).resolves.toEqual({ alertId: ALERT_ID, eventId: EVENT_ID });
    await expect(
      resolveAlertAccessSession({
        eventId: EVENT_ID,
        cookieHeader,
        repository,
        now: () => new Date(now.getTime() + ALERT_ACCESS_TTL_MS),
      }),
    ).resolves.toBeNull();
  });

  it("resolves a live subject scope from the HttpOnly cookie without returning alert identifiers", async () => {
    const expiresAt = new Date("2026-08-24T00:00:00.000Z");
    const repository: AlertSubjectSessionRepository = {
      findSubjectSession: async () => ({ sessionId: SESSION_ID, subjectId: SUBJECT_ID, expiresAt }),
    };
    // secret-scan: allow-next-line -- test-fixture
    const accessToken = "c".repeat(43);
    const cookie = `theme=paper; __Host-onjung-alert=${accessToken}; other=value`;

    expect(readAlertSessionAccessToken(cookie)).toBe(accessToken);
    await expect(resolveAlertSubjectSession({ cookieHeader: cookie, repository })).resolves.toEqual(
      { sessionId: SESSION_ID, subjectId: SUBJECT_ID, expiresAt },
    );
    await expect(resolveAlertSubjectSessionToken({ accessToken, repository })).resolves.toEqual({
      sessionId: SESSION_ID,
      subjectId: SUBJECT_ID,
      expiresAt,
    });
    expect(
      JSON.stringify(await resolveAlertSubjectSession({ cookieHeader: cookie, repository })),
    ).not.toMatch(/alert|event|token/iu);
  });

  it("rejects malformed or missing subject session cookies before repository access", async () => {
    const repository: AlertSubjectSessionRepository = {
      findSubjectSession: async () => {
        throw new Error("must not run");
      },
    };

    await expect(
      resolveAlertSubjectSession({ cookieHeader: "__Host-onjung-alert=short", repository }),
    ).resolves.toBeNull();
    await expect(
      resolveAlertSubjectSession({ cookieHeader: null, repository }),
    ).resolves.toBeNull();
  });
});
