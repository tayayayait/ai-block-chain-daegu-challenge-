import "@tanstack/react-start/server-only";

import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";

import {
  readAlertSessionAccessToken,
  resolveAlertSubjectSessionToken,
  type AlertSubjectSessionRepository,
} from "@/lib/alerts/access-token.server";
import { createSupabaseAlertRepository } from "@/lib/alerts/repository.server";
import type { ResolvedSubjectSession } from "@/lib/routing/check-in-service.server";

import {
  createSubjectShelterOriginRepository,
  type SubjectShelterOrigin,
} from "./subject-origin.server";

export type AlertSubjectShelterRequestErrorCode = "ACCESS_EXPIRED" | "SERVER_TEMPORARY";

export class AlertSubjectShelterRequestError extends Error {
  constructor(readonly code: AlertSubjectShelterRequestErrorCode) {
    super(`Alert subject shelter request failed: ${code}`);
    this.name = "AlertSubjectShelterRequestError";
  }
}

interface SubjectOriginRepository {
  findBySubjectId(subjectId: string): Promise<SubjectShelterOrigin>;
}

export interface AlertSubjectShelterRequestDependencies {
  readonly cookieHeader: string | null;
  readonly repository: AlertSubjectSessionRepository;
  readonly originRepository: SubjectOriginRepository;
  readonly now?: () => Date;
}

export type AuthorizedAlertSubjectShelterRequest = Readonly<{
  accessToken: string;
  sessionId: string;
  subjectId: string;
  expiresAt: string;
  origin: SubjectShelterOrigin;
  resolveSubjectSession: (input: {
    accessToken: string;
    subjectId: string;
    now: string;
  }) => Promise<ResolvedSubjectSession | null>;
}>;

function privateResponsePolicy(): void {
  setResponseHeader("cache-control", "private, no-store, max-age=0");
  setResponseHeader("expires", "0");
  setResponseHeader("pragma", "no-cache");
  setResponseHeader("referrer-policy", "no-referrer");
  setResponseHeader("x-robots-tag", "noindex, nofollow");
}

function productionDependencies(): AlertSubjectShelterRequestDependencies {
  privateResponsePolicy();
  return {
    cookieHeader: getRequestHeader("cookie") ?? null,
    repository: createSupabaseAlertRepository(),
    originRepository: createSubjectShelterOriginRepository(),
  };
}

/** Resolves private alert scope on every server call without accepting client subject data. */
export async function authorizeAlertSubjectShelterRequest(
  dependencies: AlertSubjectShelterRequestDependencies = productionDependencies(),
): Promise<AuthorizedAlertSubjectShelterRequest> {
  const accessToken = readAlertSessionAccessToken(dependencies.cookieHeader);
  if (!accessToken) throw new AlertSubjectShelterRequestError("ACCESS_EXPIRED");

  try {
    const now = dependencies.now?.() ?? new Date();
    const session = await resolveAlertSubjectSessionToken({
      accessToken,
      repository: dependencies.repository,
      now: () => now,
    });
    if (!session) throw new AlertSubjectShelterRequestError("ACCESS_EXPIRED");
    const origin = await dependencies.originRepository.findBySubjectId(session.subjectId);

    return Object.freeze({
      accessToken,
      sessionId: session.sessionId,
      subjectId: session.subjectId,
      expiresAt: session.expiresAt.toISOString(),
      origin,
      resolveSubjectSession: async (input) => {
        const inputNow = new Date(input.now);
        const resolved = await resolveAlertSubjectSessionToken({
          accessToken: input.accessToken,
          repository: dependencies.repository,
          now: () => inputNow,
        });
        if (!resolved || resolved.subjectId !== input.subjectId) return null;
        return Object.freeze({
          sessionId: resolved.sessionId,
          subjectId: resolved.subjectId,
          expiresAt: resolved.expiresAt.toISOString(),
        });
      },
    });
  } catch (error) {
    if (error instanceof AlertSubjectShelterRequestError) throw error;
    throw new AlertSubjectShelterRequestError("SERVER_TEMPORARY");
  }
}
