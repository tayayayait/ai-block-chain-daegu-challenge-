import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_REPORTER_COOKIE,
  resolveAnonymousReporterSession,
} from "./anonymous-session.server";

const secret = "test-only-secret-that-is-at-least-thirty-two-bytes";

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

describe("anonymous reporter HttpOnly session", () => {
  it("issues an opaque cookie and returns only its HMAC reporter hash", () => {
    const identity = resolveAnonymousReporterSession(null, secret, { secure: true });

    expect(identity.reporterHash).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.setCookie).toContain(`${ANONYMOUS_REPORTER_COOKIE}=`);
    expect(identity.setCookie).toMatch(/; HttpOnly/i);
    expect(identity.setCookie).toMatch(/; SameSite=Lax/i);
    expect(identity.setCookie).toMatch(/; Secure/i);
    expect(identity.setCookie).toMatch(/; Path=\//i);
    expect(Object.keys(identity).sort()).toEqual(["reporterHash", "setCookie"]);
    expect(JSON.stringify(identity)).not.toContain(secret);
  });

  it("reuses a valid cookie without reissuing it", () => {
    const first = resolveAnonymousReporterSession(null, secret, { secure: false });
    const second = resolveAnonymousReporterSession(cookiePair(first.setCookie ?? ""), secret, {
      secure: false,
    });

    expect(second).toEqual({ reporterHash: first.reporterHash, setCookie: null });
  });

  it("rotates malformed input instead of hashing arbitrary raw cookie text", () => {
    const identity = resolveAnonymousReporterSession(
      `${ANONYMOUS_REPORTER_COOKIE}=raw-personal-data`,
      secret,
      { secure: false },
    );

    expect(identity.setCookie).not.toBeNull();
    expect(identity.setCookie).not.toContain("raw-personal-data");
  });

  it("rejects a weak HMAC secret without echoing it", () => {
    expect(() => resolveAnonymousReporterSession(null, "weak", { secure: false })).toThrow(
      "Reporter hash secret must be at least 32 bytes",
    );
  });
});
