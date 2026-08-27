import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationRepository } from "./guards";
import { evaluateRouteAccess, type RouteAccessServerDependencies } from "./route-access.server";

const source = readFileSync(resolve(process.cwd(), "src/lib/auth/route-access.server.ts"), "utf8");

function repository(overrides: Partial<AuthorizationRepository> = {}): AuthorizationRepository {
  return {
    findProfileByUserId: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000101",
      organizationId: "00000000-0000-4000-8000-000000000001",
      role: "CARE_WORKER" as const,
    })),
    findSubjectScopeById: vi.fn(async () => ({
      id: "10000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000001",
    })),
    isSubjectAssignedToProfile: vi.fn(async () => true),
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<RouteAccessServerDependencies> = {},
): RouteAccessServerDependencies {
  return {
    getVerifiedUserId: vi.fn(async () => "00000000-0000-4000-8000-000000000101"),
    repository: repository(),
    ...overrides,
  };
}

describe("route access server evaluation", () => {
  it("allows a verified staff profile without returning profile fields", async () => {
    const result = await evaluateRouteAccess(
      { scope: "STAFF", nextPath: "/dashboard?gu=수성구" },
      dependencies(),
    );
    expect(result).toEqual({ kind: "allow" });
    expect(Object.keys(result)).toEqual(["kind"]);
  });

  it("uses subject organization and assignment checks for subject/medication routes", async () => {
    const authRepository = repository();
    const result = await evaluateRouteAccess(
      {
        scope: "SUBJECT",
        subjectId: "10000000-0000-4000-8000-000000000001",
        nextPath: "/medication/10000000-0000-4000-8000-000000000001",
      },
      dependencies({ repository: authRepository }),
    );

    expect(result).toEqual({ kind: "allow" });
    expect(authRepository.isSubjectAssignedToProfile).toHaveBeenCalledWith({
      organizationId: "00000000-0000-4000-8000-000000000001",
      profileId: "00000000-0000-4000-8000-000000000101",
      subjectId: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("redirects a missing verified session without querying any profile", async () => {
    const authRepository = repository();
    const result = await evaluateRouteAccess(
      { scope: "STAFF", nextPath: "/dashboard" },
      dependencies({ getVerifiedUserId: vi.fn(async () => null), repository: authRepository }),
    );

    expect(result).toEqual({ kind: "redirect", href: "/login?next=%2Fdashboard" });
    expect(authRepository.findProfileByUserId).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND without provider details for an unassigned subject", async () => {
    const result = await evaluateRouteAccess(
      {
        scope: "SUBJECT",
        subjectId: "10000000-0000-4000-8000-000000000001",
        nextPath: "/subjects/10000000-0000-4000-8000-000000000001",
      },
      dependencies({
        repository: repository({ isSubjectAssignedToProfile: vi.fn(async () => false) }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(result)).not.toMatch(/organization|profile|assignment/);
  });
});

describe("route access server security contract", () => {
  it("verifies Supabase user and sets private no-store response headers", () => {
    expect(source).toContain("getVerifiedUserId");
    expect(source).toContain("createSupabaseAuthorizationRepository");
    expect(source).toContain("private, no-cache, no-store, must-revalidate, max-age=0");
  });

  it("does not import an admin client, service key, or log provider data", () => {
    expect(source).not.toMatch(/createAdminSupabaseClient|SUPABASE_SECRET_KEY|service_role/);
    expect(source).not.toMatch(/console\.(?:log|debug|info|warn|error)/);
  });
});
