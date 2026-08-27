import { describe, expect, it } from "vitest";

import type { AlertAccessRepository } from "./access-token.server";
import {
  exchangeGuardianAlertTokenForRequest,
  loadGuardianAlertForRequest,
  type AlertRequestRepository,
} from "./request.server";
import type { AlertDetailRepository } from "./service.server";

const ALERT_ID = "123e4567-e89b-42d3-a456-426614174000";
const EVENT_ID = "123e4567-e89b-42d3-a456-426614174001";
const SUBJECT_ID = "123e4567-e89b-42d3-a456-426614174002";
const TOKEN = "a".repeat(43);

function requestRepository(
  overrides: {
    consume?: AlertAccessRepository["consumeOnceAndCreateSession"];
    session?: AlertAccessRepository["findValidSession"];
    detail?: AlertDetailRepository["findByAccess"];
  } = {},
): AlertRequestRepository {
  return {
    saveGrant: async () => undefined,
    consumeOnceAndCreateSession: overrides.consume ?? (async () => true),
    findValidSession: overrides.session ?? (async () => ({ alertId: ALERT_ID, eventId: EVENT_ID })),
    findByAccess:
      overrides.detail ??
      (async () => ({
        alertId: ALERT_ID,
        eventId: EVENT_ID,
        subjectId: SUBJECT_ID,
        subjectName: "김온중",
        riskLevel: "L3",
        hri: 72,
        occurredAt: "2026-08-23T12:00:00.000Z",
        reasons: ["체감 39.2℃ + 폭염경보 (+31)"],
      })),
  };
}

describe("guardian alert request boundary", () => {
  it("atomically exchanges the first token request and emits only a secure session cookie", async () => {
    const cookies: string[] = [];
    const result = await exchangeGuardianAlertTokenForRequest(
      { eventId: EVENT_ID, token: TOKEN },
      { repository: requestRepository(), setSessionCookie: (cookie) => cookies.push(cookie) },
    );

    expect(result).toEqual({ kind: "REDIRECT" });
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^__Host-onjung-alert=/);
    expect(cookies[0]).toMatch(/Max-Age=86400; HttpOnly; Secure; SameSite=Lax; Path=\/$/);
    expect(cookies[0]).not.toContain(TOKEN);
  });

  it("uses the 24-hour session cookie on refresh and never returns private repository fields", async () => {
    const result = await loadGuardianAlertForRequest(
      { eventId: EVENT_ID },
      {
        repository: requestRepository(),
        cookieHeader: "__Host-onjung-alert=" + "b".repeat(43),
      },
    );

    expect(result).toMatchObject({
      kind: "READY",
      detail: { maskedName: "김○○", hri: 72, riskLevel: "L3" },
    });
    expect(JSON.stringify(result)).not.toMatch(/김온중|010-|address|phone|subjectId/iu);
  });

  it("shows one generic response for expired, reused, mismatched, or other-browser access", async () => {
    await expect(
      exchangeGuardianAlertTokenForRequest(
        { eventId: EVENT_ID, token: TOKEN },
        {
          repository: requestRepository({ consume: async () => false }),
          setSessionCookie: () => {
            throw new Error("must not set cookie");
          },
        },
      ),
    ).resolves.toEqual({ kind: "UNAVAILABLE" });

    await expect(
      loadGuardianAlertForRequest(
        { eventId: EVENT_ID },
        { repository: requestRepository({ session: async () => null }), cookieHeader: null },
      ),
    ).resolves.toEqual({ kind: "UNAVAILABLE" });
  });
});
