import "@tanstack/react-start/server-only";

import { getCookies, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { createSessionSupabaseClient } from "@/lib/supabase/session.server";
import type { AuthorizationRepository } from "./guards";

const UuidSchema = z.string().uuid();
const ProfileRowSchema = z
  .object({
    id: UuidSchema,
    organization_id: UuidSchema,
    role: z.enum(["ADMIN", "CARE_WORKER"]),
  })
  .strict();
const SubjectScopeRowSchema = z.object({ id: UuidSchema, organization_id: UuidSchema }).strict();

type QueryResult = Promise<{ data: unknown; error: unknown }>;
type QueryChain = {
  eq(column: string, value: string): QueryChain;
  maybeSingle(): QueryResult;
};
type SupabaseQueryPort = {
  from(table: string): {
    select(columns: string): QueryChain;
  };
};
type SupabaseAuthPort = {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
};

function ensureSuccessful<T>(
  result: { data: unknown; error: unknown },
  schema: z.ZodType<T>,
): T | null {
  if (result.error) throw new Error("Authorization repository query failed");
  if (result.data === null) return null;
  return schema.parse(result.data);
}

/** Builds one Supabase SSR client for the active TanStack request. */
export function createRequestSupabaseClient() {
  return createSessionSupabaseClient({
    getAll() {
      return Object.entries(getCookies()).map(([name, value]) => ({ name, value }));
    },
    setAll(cookies) {
      for (const { name, value, options } of cookies) {
        setCookie(name, value, options);
      }
    },
  });
}

/** Uses Supabase Auth's verified getUser call; an invalid session always fails closed. */
export async function getVerifiedUserId(client: SupabaseAuthPort): Promise<string | null> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    const parsed = UuidSchema.safeParse(data.user.id);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createSupabaseAuthorizationRepository(
  client: SupabaseQueryPort,
): AuthorizationRepository {
  return {
    async findProfileByUserId(userId) {
      const row = ensureSuccessful(
        await client
          .from("profiles")
          .select("id, organization_id, role")
          .eq("id", userId)
          .maybeSingle(),
        ProfileRowSchema,
      );
      return row ? { id: row.id, organizationId: row.organization_id, role: row.role } : null;
    },

    async findSubjectScopeById(subjectId) {
      const row = ensureSuccessful(
        await client
          .from("subjects")
          .select("id, organization_id")
          .eq("id", subjectId)
          .maybeSingle(),
        SubjectScopeRowSchema,
      );
      return row ? { id: row.id, organizationId: row.organization_id } : null;
    },

    async isSubjectAssignedToProfile(input) {
      const result = await client
        .from("subject_assignments")
        .select("subject_id")
        .eq("organization_id", input.organizationId)
        .eq("profile_id", input.profileId)
        .eq("subject_id", input.subjectId)
        .maybeSingle();
      if (result.error) throw new Error("Authorization repository query failed");
      return result.data !== null;
    },
  };
}
