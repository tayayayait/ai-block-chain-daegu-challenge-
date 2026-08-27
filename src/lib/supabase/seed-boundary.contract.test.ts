import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const readProjectFile = (path: string) => readFileSync(resolve(projectRoot, path), "utf8");

const forbiddenSharedSeedMarkers = [
  "auth.users",
  "demo-admin",
  "가상 대상자",
  "DEMO_FIXTURE_NOT_REAL_DATA",
  "apihub:demo",
] as const;

describe("Supabase production-safe seed boundary", () => {
  it("disables automatic seed execution in the shared Supabase config", () => {
    const config = readProjectFile("supabase/config.toml");
    const seedConfig = config.split("[db.seed]")[1]?.split("\n[")[0] ?? "";

    expect(seedConfig).toMatch(/^enabled\s*=\s*false\s*$/mu);
    expect(seedConfig).not.toMatch(/fixtures\/local-demo\.sql/iu);
  });

  it("keeps the conventional seed file production-safe", () => {
    const sharedSeed = readProjectFile("supabase/seed.sql");

    for (const marker of forbiddenSharedSeedMarkers) {
      expect(sharedSeed).not.toContain(marker);
    }
    expect(sharedSeed).toMatch(/intentionally empty/iu);
  });

  it("stores demo data only in an unregistered local fixture", () => {
    const fixturePath = resolve(projectRoot, "supabase/fixtures/local-demo.sql");
    expect(existsSync(fixturePath)).toBe(true);

    const fixture = readFileSync(fixturePath, "utf8");
    for (const marker of forbiddenSharedSeedMarkers) {
      expect(fixture).toContain(marker);
    }

    const config = readProjectFile("supabase/config.toml");
    expect(config).not.toContain("fixtures/local-demo.sql");
  });

  it("routes the public reset command through the no-passthrough safety wrapper", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readProjectFile(".github/workflows/ci.yml");
    const generator = readProjectFile("scripts/generate-supabase-seed.ts");
    const resetWrapper = readProjectFile("scripts/reset-local-supabase.ts");

    expect(packageJson.scripts?.["supabase:reset"]).toBe("node scripts/reset-local-supabase.ts");
    expect(workflow).toContain("bun run supabase:reset");
    expect(generator).toContain('"supabase", "fixtures", "local-demo.sql"');
    expect(generator).not.toContain('"supabase", "seed.sql"');
    expect(resetWrapper).toContain('process.platform === "win32" ? "supabase.exe" : "supabase"');
    expect(resetWrapper).not.toContain('"supabase.cmd"');
    expect(resetWrapper).toMatch(/existsSync\(cliPath\)/u);
  });
});
