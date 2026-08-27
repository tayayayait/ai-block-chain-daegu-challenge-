import "@tanstack/react-start/server-only";

import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSubjectAccess, type SubjectGuardInput } from "@/lib/auth/guards";
import {
  createRequestSupabaseClient,
  createSupabaseAuthorizationRepository,
  getVerifiedUserId,
} from "@/lib/auth/supabase-auth.server";

import {
  createSubjectShelterOriginRepository,
  type SubjectShelterOrigin,
} from "./subject-origin.server";

const SubjectIdSchema = z.string().uuid();

export type SubjectShelterRequestErrorCode =
  "AUTHENTICATION_REQUIRED" | "NOT_FOUND" | "SERVER_TEMPORARY";

export class SubjectShelterRequestError extends Error {
  constructor(readonly code: SubjectShelterRequestErrorCode) {
    super(`Subject shelter request failed: ${code}`);
    this.name = "SubjectShelterRequestError";
  }
}

export type AuthorizedSubjectShelterRequest = Readonly<{
  userId: string;
  origin: SubjectShelterOrigin;
  authorizeSubject: (input: SubjectGuardInput) => ReturnType<typeof requireSubjectAccess>;
}>;

/** Reauthorizes every server-function call before a private subject coordinate is read. */
export async function authorizeSubjectShelterRequest(input: {
  subjectId: string;
  nextPath?: string;
}): Promise<AuthorizedSubjectShelterRequest> {
  const subjectId = SubjectIdSchema.safeParse(input.subjectId);
  if (!subjectId.success) throw new SubjectShelterRequestError("NOT_FOUND");

  setResponseHeader("cache-control", "private, no-cache, no-store, must-revalidate, max-age=0");
  setResponseHeader("referrer-policy", "no-referrer");

  try {
    const client = createRequestSupabaseClient();
    const repository = createSupabaseAuthorizationRepository(
      client as unknown as Parameters<typeof createSupabaseAuthorizationRepository>[0],
    );
    const userId = await getVerifiedUserId(client);
    const nextPath = input.nextPath ?? `/shelters?subjectId=${encodeURIComponent(subjectId.data)}`;
    const access = await requireSubjectAccess(
      { userId, subjectId: subjectId.data, nextPath },
      repository,
    );
    if (access.kind === "redirect") {
      throw new SubjectShelterRequestError("AUTHENTICATION_REQUIRED");
    }
    if (access.kind === "error") {
      throw new SubjectShelterRequestError(
        access.error.code === "NOT_FOUND" ? "NOT_FOUND" : "SERVER_TEMPORARY",
      );
    }
    if (!userId) throw new SubjectShelterRequestError("AUTHENTICATION_REQUIRED");

    const origin = await createSubjectShelterOriginRepository().findBySubjectId(subjectId.data);
    return Object.freeze({
      userId,
      origin,
      authorizeSubject: (request) => requireSubjectAccess(request, repository),
    });
  } catch (error) {
    if (error instanceof SubjectShelterRequestError) throw error;
    throw new SubjectShelterRequestError("SERVER_TEMPORARY");
  }
}
