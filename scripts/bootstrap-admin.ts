import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  bootstrapFirstAdmin,
  createSupabaseAdminBootstrapRepository,
} from "../src/lib/admin/bootstrap.server";

const BootstrapEnvironmentSchema = z.object({
  SUPABASE_URL: z
    .string()
    .url()
    .transform((value) => new URL(value).origin),
  SUPABASE_SECRET_KEY: z.string().trim().min(1),
  BOOTSTRAP_ADMIN_EMAIL: z.string().trim().email(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(128),
  BOOTSTRAP_ORGANIZATION_NAME: z.string().trim().min(1).max(120),
  BOOTSTRAP_ADMIN_DISPLAY_NAME: z.string().trim().min(1).max(80),
});

async function main(): Promise<void> {
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== "--apply") {
    throw new Error("Usage: bun scripts/bootstrap-admin.ts --apply");
  }
  const environment = BootstrapEnvironmentSchema.parse(process.env);
  const client = createClient(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const result = await bootstrapFirstAdmin(
    {
      email: environment.BOOTSTRAP_ADMIN_EMAIL,
      password: environment.BOOTSTRAP_ADMIN_PASSWORD,
      organizationName: environment.BOOTSTRAP_ORGANIZATION_NAME,
      displayName: environment.BOOTSTRAP_ADMIN_DISPLAY_NAME,
    },
    createSupabaseAdminBootstrapRepository(client),
  );
  process.stdout.write(`First ADMIN provisioning completed (${result.status}).\n`);
}

try {
  await main();
} catch {
  process.stderr.write(
    "First ADMIN provisioning failed. Check the required variable names and Supabase state; secret values were not printed.\n",
  );
  process.exitCode = 1;
}
