import "@tanstack/react-start/server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnv, type ServerEnv } from "../env.server";

export type AdminSupabaseEnvironment = Pick<ServerEnv, "SUPABASE_URL" | "SUPABASE_SECRET_KEY">;

/** Server-only service client for trusted batch/ETL jobs; it must never enter a route payload. */
export function createAdminSupabaseClient(environment: AdminSupabaseEnvironment = getServerEnv()) {
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
