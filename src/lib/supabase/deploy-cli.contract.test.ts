import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/push-supabase-migrations.ts");
const script = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";

describe("production Supabase migration deploy CLI", () => {
  it("uses the strict deploy policy and exact linked project instead of forwarding raw arguments", () => {
    expect(script).toContain("parseSupabaseDeployCli");
    expect(script).toContain("buildSupabasePushArgs");
    expect(script).toContain("supabase/.temp/project-ref");
    expect(script).not.toContain("--include-seed");
    expect(script).not.toMatch(/spawn\([^)]*process\.argv\.slice/su);
  });

  it("requires the explicit compatibility confirmation only through a named environment variable", () => {
    expect(script).toContain('process.env["ONJUNG_COMPAT_DEPLOYMENT_DRAINED"]');
    expect(script).not.toMatch(/console\.(?:log|error)\([^)]*process\.env/su);
  });
});
