import "@tanstack/react-start/server-only";

import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";

import { z } from "zod";

const IdSchema = z.string().uuid();
const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const ALERT_ACCESS_TTL_MS = 24 * 60 * 60 * 1_000;
const SECURE_SESSION_COOKIE = "__Host-onjung-alert";

export interface AlertAccessRepository {
  saveGrant(input: {
    alertId: string;
    eventId: string;
    claimToken: string;
    expectedLeaseUntil: Date;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  consumeOnceAndCreateSession(input: {
    tokenHash: string;
    eventId: string;
    now: Date;
    sessionHash: string;
    sessionExpiresAt: Date;
  }): Promise<boolean>;
  findValidSession(input: {
    sessionHash: string;
    eventId: string;
    now: Date;
  }): Promise<{ alertId: string; eventId: string } | null>;
}

export interface AlertSubjectSessionRepository {
  findSubjectSession(input: {
    sessionHash: string;
    now: Date;
  }): Promise<{ sessionId: string; subjectId: string; expiresAt: Date } | null>;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const base64Url = (value: Uint8Array): string => Buffer.from(value).toString("base64url");
const secureRandom = (): Uint8Array => nodeRandomBytes(32);

export const createAlertAccessGrant = async (input: {
  alertId: string;
  eventId: string;
  claimToken: string;
  expectedLeaseUntil: Date;
  repository: AlertAccessRepository;
  now?: () => Date;
  randomBytes?: () => Uint8Array;
}): Promise<{ token: string; expiresAt: Date }> => {
  const alertId = IdSchema.parse(input.alertId);
  const eventId = IdSchema.parse(input.eventId);
  const claimToken = IdSchema.parse(input.claimToken);
  const now = input.now?.() ?? new Date();
  if (
    !Number.isFinite(input.expectedLeaseUntil.getTime()) ||
    input.expectedLeaseUntil.getTime() <= now.getTime()
  ) {
    throw new Error("Alert access lease must be active");
  }
  const entropy = (input.randomBytes ?? secureRandom)();
  if (entropy.byteLength !== 32) throw new Error("Alert token entropy must be 256 bits");
  const token = base64Url(entropy);
  const expiresAt = new Date(now.getTime() + ALERT_ACCESS_TTL_MS);
  await input.repository.saveGrant({
    alertId,
    eventId,
    claimToken,
    expectedLeaseUntil: input.expectedLeaseUntil,
    tokenHash: sha256(token),
    expiresAt,
  });
  return { token, expiresAt };
};

const parseCookie = (cookieHeader: string | null, name: string): string | null => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
};

export const readAlertSessionAccessToken = (cookieHeader: string | null): string | null => {
  const parsed = TokenSchema.safeParse(parseCookie(cookieHeader, SECURE_SESSION_COOKIE));
  return parsed.success ? parsed.data : null;
};

export type AlertAccessExchangeResult =
  Readonly<{ kind: "SUCCESS"; setCookie: string }> | Readonly<{ kind: "INVALID_OR_EXPIRED" }>;

export const exchangeAlertAccessToken = async (input: {
  eventId: string;
  token: string;
  repository: AlertAccessRepository;
  now?: () => Date;
  randomBytes?: () => Uint8Array;
}): Promise<AlertAccessExchangeResult> => {
  const eventId = IdSchema.safeParse(input.eventId);
  const token = TokenSchema.safeParse(input.token);
  if (!eventId.success || !token.success) return { kind: "INVALID_OR_EXPIRED" };

  const entropy = (input.randomBytes ?? secureRandom)();
  if (entropy.byteLength !== 32) return { kind: "INVALID_OR_EXPIRED" };
  const sessionToken = base64Url(entropy);
  const now = input.now?.() ?? new Date();
  const consumed = await input.repository.consumeOnceAndCreateSession({
    tokenHash: sha256(token.data),
    eventId: eventId.data,
    now,
    sessionHash: sha256(sessionToken),
    sessionExpiresAt: new Date(now.getTime() + ALERT_ACCESS_TTL_MS),
  });
  if (!consumed) return { kind: "INVALID_OR_EXPIRED" };

  return {
    kind: "SUCCESS",
    setCookie: `${SECURE_SESSION_COOKIE}=${sessionToken}; Max-Age=86400; HttpOnly; Secure; SameSite=Lax; Path=/`,
  };
};

export const resolveAlertAccessSession = async (input: {
  eventId: string;
  cookieHeader: string | null;
  repository: AlertAccessRepository;
  now?: () => Date;
}): Promise<{ alertId: string; eventId: string } | null> => {
  const eventId = IdSchema.safeParse(input.eventId);
  if (!eventId.success) return null;
  const token = TokenSchema.safeParse(parseCookie(input.cookieHeader, SECURE_SESSION_COOKIE));
  if (!token.success) return null;
  return input.repository.findValidSession({
    sessionHash: sha256(token.data),
    eventId: eventId.data,
    now: input.now?.() ?? new Date(),
  });
};

export const resolveAlertSubjectSessionToken = async (input: {
  accessToken: string;
  repository: AlertSubjectSessionRepository;
  now?: () => Date;
}): Promise<{ sessionId: string; subjectId: string; expiresAt: Date } | null> => {
  const accessToken = TokenSchema.safeParse(input.accessToken);
  if (!accessToken.success) return null;
  const now = input.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) return null;
  return input.repository.findSubjectSession({
    sessionHash: sha256(accessToken.data),
    now,
  });
};

export const resolveAlertSubjectSession = async (input: {
  cookieHeader: string | null;
  repository: AlertSubjectSessionRepository;
  now?: () => Date;
}): Promise<{ sessionId: string; subjectId: string; expiresAt: Date } | null> => {
  const accessToken = readAlertSessionAccessToken(input.cookieHeader);
  if (!accessToken) return null;
  return resolveAlertSubjectSessionToken({
    accessToken,
    repository: input.repository,
    ...(input.now ? { now: input.now } : {}),
  });
};
