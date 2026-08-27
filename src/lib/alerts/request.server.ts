import "@tanstack/react-start/server-only";

import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import {
  exchangeAlertAccessToken,
  resolveAlertAccessSession,
  type AlertAccessRepository,
} from "./access-token.server";
import { createSupabaseAlertRepository } from "./repository.server";
import {
  loadGuardianAlertDetail,
  type AlertDetailRepository,
  type GuardianAlertDetailResult,
} from "./service.server";

const EventRequestSchema = z.object({ eventId: z.string().uuid() }).strict();
const TokenExchangeRequestSchema = EventRequestSchema.extend({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}).strict();

export type AlertRequestRepository = AlertAccessRepository & AlertDetailRepository;

type TokenExchangeDependencies = Readonly<{
  repository: AlertRequestRepository;
  setSessionCookie: (cookie: string) => void;
}>;

type DetailDependencies = Readonly<{
  repository: AlertRequestRepository;
  cookieHeader: string | null;
}>;

function applyPrivateResponsePolicy(): void {
  setResponseHeader("cache-control", "private, no-store, max-age=0");
  setResponseHeader("expires", "0");
  setResponseHeader("pragma", "no-cache");
  setResponseHeader("referrer-policy", "no-referrer");
  setResponseHeader("x-robots-tag", "noindex, nofollow");
}

function productionTokenDependencies(): TokenExchangeDependencies {
  applyPrivateResponsePolicy();
  return {
    repository: createSupabaseAlertRepository(),
    setSessionCookie: (cookie) => setResponseHeader("set-cookie", cookie),
  };
}

function productionDetailDependencies(): DetailDependencies {
  applyPrivateResponsePolicy();
  return {
    repository: createSupabaseAlertRepository(),
    cookieHeader: getRequestHeader("cookie") ?? null,
  };
}

export type AlertTokenExchangeResult =
  Readonly<{ kind: "REDIRECT" }> | Readonly<{ kind: "UNAVAILABLE" }>;

export async function exchangeGuardianAlertTokenForRequest(
  rawInput: unknown,
  dependencies: TokenExchangeDependencies = productionTokenDependencies(),
): Promise<AlertTokenExchangeResult> {
  const input = TokenExchangeRequestSchema.safeParse(rawInput);
  if (!input.success) return { kind: "UNAVAILABLE" };

  try {
    const exchange = await exchangeAlertAccessToken({
      eventId: input.data.eventId,
      token: input.data.token,
      repository: dependencies.repository,
    });
    if (exchange.kind !== "SUCCESS") return { kind: "UNAVAILABLE" };

    dependencies.setSessionCookie(exchange.setCookie);
    return { kind: "REDIRECT" };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}

export async function loadGuardianAlertForRequest(
  rawInput: unknown,
  dependencies: DetailDependencies = productionDetailDependencies(),
): Promise<GuardianAlertDetailResult> {
  const input = EventRequestSchema.safeParse(rawInput);
  if (!input.success) return { kind: "UNAVAILABLE" };

  try {
    const access = await resolveAlertAccessSession({
      eventId: input.data.eventId,
      cookieHeader: dependencies.cookieHeader,
      repository: dependencies.repository,
    });
    if (!access) return { kind: "UNAVAILABLE" };
    return loadGuardianAlertDetail(access, dependencies.repository);
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}
