import { describe, expect, it, vi } from "vitest";

import type { AlertSubjectSessionRepository } from "@/lib/alerts/access-token.server";

import {
  AlertSubjectShelterRequestError,
  authorizeAlertSubjectShelterRequest,
} from "./alert-subject-request.server";

const SESSION_ID = "60000000-0000-4000-8000-000000000001";
const SUBJECT_ID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-24T04:00:00.000Z");
// secret-scan: allow-next-line -- test-fixture
const ACCESS_TOKEN = "a".repeat(43);

function repository(
  session: { sessionId: string; subjectId: string; expiresAt: Date } | null,
): AlertSubjectSessionRepository {
  return { findSubjectSession: vi.fn(async () => session) };
}

describe("alert-scoped shelter authorization", () => {
  it("resolves the subject and origin from the cookie only and keeps URL identifiers unnecessary", async () => {
    const findBySubjectId = vi.fn(async () => ({ latitude: 35.8714, longitude: 128.6014 }));
    const access = await authorizeAlertSubjectShelterRequest({
      cookieHeader: `__Host-onjung-alert=${ACCESS_TOKEN}`,
      repository: repository({
        sessionId: SESSION_ID,
        subjectId: SUBJECT_ID,
        expiresAt: new Date("2026-08-24T05:00:00.000Z"),
      }),
      originRepository: { findBySubjectId },
      now: () => NOW,
    });

    expect(findBySubjectId).toHaveBeenCalledWith(SUBJECT_ID);
    expect(access).toMatchObject({
      sessionId: SESSION_ID,
      subjectId: SUBJECT_ID,
      origin: { latitude: 35.8714, longitude: 128.6014 },
    });
    await expect(
      access.resolveSubjectSession({
        accessToken: ACCESS_TOKEN,
        subjectId: SUBJECT_ID,
        now: NOW.toISOString(),
      }),
    ).resolves.toMatchObject({ sessionId: SESSION_ID, subjectId: SUBJECT_ID });
  });

  it("fails closed before reading origin when the cookie is absent or expired", async () => {
    const findBySubjectId = vi.fn();
    await expect(
      authorizeAlertSubjectShelterRequest({
        cookieHeader: null,
        repository: repository(null),
        originRepository: { findBySubjectId },
        now: () => NOW,
      }),
    ).rejects.toEqual(new AlertSubjectShelterRequestError("ACCESS_EXPIRED"));
    await expect(
      authorizeAlertSubjectShelterRequest({
        cookieHeader: `__Host-onjung-alert=${ACCESS_TOKEN}`,
        repository: repository(null),
        originRepository: { findBySubjectId },
        now: () => NOW,
      }),
    ).rejects.toEqual(new AlertSubjectShelterRequestError("ACCESS_EXPIRED"));
    expect(findBySubjectId).not.toHaveBeenCalled();
  });

  it("replaces private repository diagnostics with a stable error", async () => {
    const error = await authorizeAlertSubjectShelterRequest({
      cookieHeader: `__Host-onjung-alert=${ACCESS_TOKEN}`,
      repository: {
        findSubjectSession: async () => {
          throw new Error(`private-${ACCESS_TOKEN}-${SUBJECT_ID}`);
        },
      },
      originRepository: { findBySubjectId: vi.fn() },
      now: () => NOW,
    }).catch((reason: unknown) => reason);

    expect(error).toEqual(new AlertSubjectShelterRequestError("SERVER_TEMPORARY"));
    expect(JSON.stringify(error)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(error)).not.toContain(SUBJECT_ID);
  });
});
