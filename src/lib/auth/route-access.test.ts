import { isNotFound, isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { AppError, createPublicError } from "@/lib/error-dto";

import {
  enforceRouteAccessResult,
  loginSearchSchema,
  protectedLocationPath,
  requireMedicationSubjectRouteAccess,
  requireSubjectRouteAccess,
  sanitizeProtectedNextPath,
} from "./route-access";

describe("protected next path", () => {
  it.each([
    ["/dashboard?gu=수성구&level=L3", "/dashboard?gu=수성구&level=L3"],
    [
      "/subjects/10000000-0000-4000-8000-000000000001",
      "/subjects/10000000-0000-4000-8000-000000000001",
    ],
    [
      "/medication/10000000-0000-4000-8000-000000000001?step=capture",
      "/medication/10000000-0000-4000-8000-000000000001?step=capture",
    ],
    [
      "/shelters?subjectId=10000000-0000-4000-8000-000000000001",
      "/shelters?subjectId=10000000-0000-4000-8000-000000000001",
    ],
  ])("preserves safe protected path %s", (candidate, expected) => {
    expect(sanitizeProtectedNextPath(candidate)).toBe(expected);
    expect(loginSearchSchema.parse({ next: candidate })).toEqual({ next: expected });
  });

  it.each([
    undefined,
    "https://evil.example/steal",
    "//evil.example/steal",
    "/subjects/%2e%2e/dashboard",
    "/dashboard\\@evil.example",
    `/dashboard?${"x".repeat(2100)}`,
  ])("falls back for unsafe next value %s", (candidate) => {
    expect(sanitizeProtectedNextPath(candidate)).toBe("/dashboard");
    expect(loginSearchSchema.parse({ next: candidate })).toEqual({ next: "/dashboard" });
  });

  it("builds a protected next path without carrying a fragment", () => {
    expect(
      protectedLocationPath({
        pathname: "/dashboard",
        searchStr: "?gu=수성구",
        hash: "private-fragment",
      }),
    ).toBe("/dashboard?gu=수성구");
  });
});

describe("route access result enforcement", () => {
  it("exposes the same subject guard entry point for future medication routes", () => {
    expect(requireMedicationSubjectRouteAccess).toBe(requireSubjectRouteAccess);
  });

  it("fails an invalid subject id as not-found before any server request", async () => {
    let thrown: unknown;
    try {
      await requireSubjectRouteAccess({
        subjectId: "not-a-uuid",
        nextPath: "/subjects/not-a-uuid",
      });
    } catch (error) {
      thrown = error;
    }
    expect(isNotFound(thrown)).toBe(true);
  });

  it("returns normally only for allow", () => {
    expect(enforceRouteAccessResult({ kind: "allow" })).toBeUndefined();
  });

  it("turns unauthenticated results into an internal login redirect", () => {
    let thrown: unknown;
    try {
      enforceRouteAccessResult({ kind: "redirect", href: "/login?next=%2Fdashboard" });
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown)).toBe(true);
  });

  it("hides denied subject existence with TanStack not-found", () => {
    let thrown: unknown;
    try {
      enforceRouteAccessResult({ kind: "error", error: createPublicError("NOT_FOUND") });
    } catch (error) {
      thrown = error;
    }
    expect(isNotFound(thrown)).toBe(true);
  });

  it("throws only a catalog AppError for infrastructure failures", () => {
    expect(() =>
      enforceRouteAccessResult({ kind: "error", error: createPublicError("INTERNAL_ERROR") }),
    ).toThrowError(AppError);
  });
});
