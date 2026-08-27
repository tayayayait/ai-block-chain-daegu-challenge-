import "@tanstack/react-start/server-only";

import { createServerClient } from "@supabase/ssr";

import { getServerEnv, type ServerEnv } from "../env.server";

type ServerClientOptions = Parameters<typeof createServerClient>[2];

export type SupabaseCookieMethods = ServerClientOptions["cookies"];
export type SessionSupabaseEnvironment = Pick<
  ServerEnv,
  "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY"
>;

/** Creates one user-session client per request so cookies are never shared across users. */
export function createSessionSupabaseClient(
  cookies: SupabaseCookieMethods,
  environment: SessionSupabaseEnvironment = getServerEnv(),
) {
  return createServerClient(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
    cookies,
  });
}
