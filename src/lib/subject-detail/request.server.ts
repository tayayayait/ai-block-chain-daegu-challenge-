import "@tanstack/react-start/server-only";

import { getCookies, setCookie, setResponseHeader } from "@tanstack/react-start/server";

import { requireSubjectAccess } from "@/lib/auth/guards";
import { createPublicError } from "@/lib/error-dto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";
import { createSessionSupabaseClient } from "@/lib/supabase/session.server";
import {
  getFullSubjectPii,
  type FullPiiPurpose,
  type SubjectReadResult,
} from "@/lib/subjects/service.server";
import type { FullSubjectPiiDto } from "@/lib/subjects/dto";

import {
  createPrivateSubjectRepository,
  createSubjectAuthorizationRepository,
  createSubjectDetailRepository,
} from "./repository.server";
import { getSubjectDetail, type SubjectDetailReadResult } from "./service.server";

type SubjectRequest = Readonly<{ subjectId: string }>;
type SubjectRevealRequest = SubjectRequest & Readonly<{ purpose: FullPiiPurpose }>;

function applySupabaseResponseHeaders(headers: Record<string, string>): void {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  if (normalized["cache-control"]) {
    setResponseHeader("cache-control", normalized["cache-control"]);
  }
  if (normalized["expires"]) setResponseHeader("expires", normalized["expires"]);
  if (normalized["pragma"]) setResponseHeader("pragma", normalized["pragma"]);
}

function createRequestSessionClient() {
  setResponseHeader("cache-control", "private, no-cache, no-store, must-revalidate, max-age=0");
  setResponseHeader("expires", "0");
  setResponseHeader("pragma", "no-cache");

  return createSessionSupabaseClient({
    getAll: () =>
      Object.entries(getCookies()).map(([name, value]) => ({
        name,
        value,
      })),
    setAll: (cookiesToSet, headers) => {
      for (const { name, value, options } of cookiesToSet) {
        setCookie(name, value, options);
      }
      applySupabaseResponseHeaders(headers);
    },
  });
}

async function getTrustedUserId(sessionClient: ReturnType<typeof createRequestSessionClient>) {
  const { data, error } = await sessionClient.auth.getUser();
  if (error && data.user) throw new Error("SUBJECT_DETAIL_AUTH_FAILED");
  return data.user?.id ?? null;
}

export async function loadSubjectDetailForRequest(
  input: SubjectRequest,
): Promise<SubjectDetailReadResult> {
  try {
    const sessionClient = createRequestSessionClient();
    const userId = await getTrustedUserId(sessionClient);
    const authorizationRepository = createSubjectAuthorizationRepository(sessionClient);

    return await getSubjectDetail(
      {
        userId,
        subjectId: input.subjectId,
        nextPath: `/subjects/${encodeURIComponent(input.subjectId)}`,
      },
      {
        authorizeSubject: (guardInput) => requireSubjectAccess(guardInput, authorizationRepository),
        repository: createSubjectDetailRepository(sessionClient, createAdminSupabaseClient()),
      },
    );
  } catch {
    return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
  }
}

export async function revealSubjectPiiForRequest(
  input: SubjectRevealRequest,
): Promise<SubjectReadResult<FullSubjectPiiDto>> {
  try {
    const sessionClient = createRequestSessionClient();
    const userId = await getTrustedUserId(sessionClient);
    const authorizationRepository = createSubjectAuthorizationRepository(sessionClient);

    return await getFullSubjectPii(
      {
        userId,
        subjectId: input.subjectId,
        nextPath: `/subjects/${encodeURIComponent(input.subjectId)}`,
        purpose: input.purpose,
      },
      {
        authorizeSubject: (guardInput) => requireSubjectAccess(guardInput, authorizationRepository),
        authorizeFullPii: async ({ profile, purpose }) =>
          purpose === "CARE_COORDINATION" &&
          (profile.role === "ADMIN" || profile.role === "CARE_WORKER"),
        repository: createPrivateSubjectRepository(createAdminSupabaseClient()),
      },
    );
  } catch {
    return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
  }
}
