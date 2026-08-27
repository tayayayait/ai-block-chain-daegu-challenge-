import "@tanstack/react-start/server-only";

import { createHmac, randomBytes } from "node:crypto";

export const ANONYMOUS_REPORTER_COOKIE = "onjung_reporter";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface AnonymousReporterIdentity {
  readonly reporterHash: string;
  readonly setCookie: string | null;
}

function assertStrongSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Reporter hash secret must be at least 32 bytes");
  }
}

function readReporterToken(cookieHeader: string | null): string | null {
  if (cookieHeader === null) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === ANONYMOUS_REPORTER_COOKIE && TOKEN_PATTERN.test(value)) return value;
  }
  return null;
}

function reporterHash(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

function createSetCookie(token: string, secure: boolean): string {
  return [
    `${ANONYMOUS_REPORTER_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function resolveAnonymousReporterSession(
  cookieHeader: string | null,
  secret: string,
  options: Readonly<{ secure: boolean }>,
): AnonymousReporterIdentity {
  assertStrongSecret(secret);
  const existingToken = readReporterToken(cookieHeader);
  const token = existingToken ?? randomBytes(32).toString("base64url");

  return Object.freeze({
    reporterHash: reporterHash(token, secret),
    setCookie: existingToken === null ? createSetCookie(token, options.secure) : null,
  });
}
