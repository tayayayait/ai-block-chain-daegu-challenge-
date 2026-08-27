import "@tanstack/react-start/server-only";

import { setResponseHeader } from "@tanstack/react-start/server";

import { createPublicError } from "@/lib/error-dto";

import {
  requireStaffAccess,
  requireSubjectAccess,
  type AuthorizationRepository,
  type StaffGuardResult,
  type SubjectGuardResult,
} from "./guards";
import {
  createRequestSupabaseClient,
  createSupabaseAuthorizationRepository,
  getVerifiedUserId,
} from "./supabase-auth.server";
import type { RouteAccessRequest, RouteAccessResult } from "./route-access";

export type RouteAccessServerDependencies = Readonly<{
  getVerifiedUserId: () => Promise<string | null>;
  repository: AuthorizationRepository;
}>;

function publicResult(result: StaffGuardResult | SubjectGuardResult): RouteAccessResult {
  if (result.kind === "allow") return { kind: "allow" };
  return result;
}

export async function evaluateRouteAccess(
  input: RouteAccessRequest,
  dependencies: RouteAccessServerDependencies,
): Promise<RouteAccessResult> {
  let userId: string | null;
  try {
    userId = await dependencies.getVerifiedUserId();
  } catch {
    return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
  }

  if (input.scope === "STAFF") {
    return publicResult(
      await requireStaffAccess({ userId, nextPath: input.nextPath }, dependencies.repository),
    );
  }

  return publicResult(
    await requireSubjectAccess(
      {
        userId,
        subjectId: input.subjectId,
        nextPath: input.nextPath,
      },
      dependencies.repository,
    ),
  );
}

function setPrivateNoStoreHeaders(): void {
  setResponseHeader("cache-control", "private, no-cache, no-store, must-revalidate, max-age=0");
  setResponseHeader("expires", "0");
  setResponseHeader("pragma", "no-cache");
}

export async function authorizeRouteAccessForRequest(
  input: RouteAccessRequest,
): Promise<RouteAccessResult> {
  setPrivateNoStoreHeaders();

  try {
    const client = createRequestSupabaseClient();
    const queryPort = client as unknown as Parameters<
      typeof createSupabaseAuthorizationRepository
    >[0];
    return await evaluateRouteAccess(input, {
      getVerifiedUserId: () => getVerifiedUserId(client),
      repository: createSupabaseAuthorizationRepository(queryPort),
    });
  } catch {
    return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
  }
}
