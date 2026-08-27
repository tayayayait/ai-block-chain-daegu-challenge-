import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { AppError, type PublicErrorDto } from "@/lib/error-dto";

import { createLoginRedirect } from "./guards";

const MAX_NEXT_PATH_LENGTH = 2048;
const subjectIdSchema = z.string().uuid();

export type RouteAccessRequest =
  | Readonly<{ scope: "STAFF"; nextPath: string }>
  | Readonly<{ scope: "SUBJECT"; subjectId: string; nextPath: string }>;

export type RouteAccessResult =
  | Readonly<{ kind: "allow" }>
  | Readonly<{ kind: "redirect"; href: string }>
  | Readonly<{ kind: "error"; error: PublicErrorDto }>;

export function sanitizeProtectedNextPath(candidate: unknown): string {
  if (typeof candidate !== "string" || candidate.length > MAX_NEXT_PATH_LENGTH) {
    return "/dashboard";
  }

  const href = createLoginRedirect(candidate).href;
  try {
    return new URL(href, "https://onjung.invalid").searchParams.get("next") ?? "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export const loginSearchSchema = z
  .object({ next: z.unknown().optional() })
  .passthrough()
  .transform(({ next }) => ({ next: sanitizeProtectedNextPath(next) }));

const routeAccessRequestSchema = z
  .discriminatedUnion("scope", [
    z.object({ scope: z.literal("STAFF"), nextPath: z.string() }).strict(),
    z
      .object({
        scope: z.literal("SUBJECT"),
        subjectId: subjectIdSchema,
        nextPath: z.string(),
      })
      .strict(),
  ])
  .transform((input): RouteAccessRequest => ({
    ...input,
    nextPath: sanitizeProtectedNextPath(input.nextPath),
  }));

const verifyRouteAccess = createServerFn({ method: "GET" })
  .validator((input: unknown) => routeAccessRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const { authorizeRouteAccessForRequest } = await import("./route-access.server");
    return authorizeRouteAccessForRequest(data);
  });

export function protectedLocationPath(location: {
  pathname: string;
  searchStr: string;
  hash?: string;
}): string {
  return `${location.pathname}${location.searchStr}`;
}

export function enforceRouteAccessResult(result: RouteAccessResult): void {
  if (result.kind === "allow") return;
  if (result.kind === "redirect") throw redirect({ href: result.href });
  if (result.error.code === "NOT_FOUND") throw notFound();
  throw new AppError(result.error.code);
}

export async function requireStaffRouteAccess(nextPath: string): Promise<void> {
  const result = await verifyRouteAccess({
    data: { scope: "STAFF", nextPath: sanitizeProtectedNextPath(nextPath) },
  });
  enforceRouteAccessResult(result);
}

export async function requireSubjectRouteAccess(input: {
  subjectId: string;
  nextPath: string;
}): Promise<void> {
  const subjectId = subjectIdSchema.safeParse(input.subjectId);
  if (!subjectId.success) throw notFound();

  const result = await verifyRouteAccess({
    data: {
      scope: "SUBJECT",
      subjectId: subjectId.data,
      nextPath: sanitizeProtectedNextPath(input.nextPath),
    },
  });
  enforceRouteAccessResult(result);
}

/** Phase 4 담당자형 복약 라우트가 동일한 subject guard를 재사용하는 진입점입니다. */
export const requireMedicationSubjectRouteAccess = requireSubjectRouteAccess;
