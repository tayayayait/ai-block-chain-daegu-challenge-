import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const sql = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(resolve(migrationsDirectory, file), "utf8"))
  .join("\n");

const PUBLIC_TABLES = [
  "organizations",
  "profiles",
  "subjects",
  "subject_assignments",
  "shelters",
  "medication_scan_sessions",
  "medications",
  "medication_api_cache",
  "weather_snapshots",
  "risk_snapshots",
  "alert_transitions",
  "shelter_reports",
  "shelter_checkins",
  "care_events",
  "guardian_alerts",
  "alert_access_tokens",
  "attestation_jobs",
] as const;

describe("Phase 2 RLS and least privilege", () => {
  it.each(PUBLIC_TABLES)("enables and forces RLS on public.%s", (table) => {
    expect(sql).toMatch(
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
    );
    expect(sql).toMatch(
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+force\\s+row\\s+level\\s+security`, "i"),
    );
  });

  it.each(PUBLIC_TABLES)("revokes ambient anon/authenticated access on public.%s", (table) => {
    expect(sql).toMatch(
      new RegExp(
        `revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+anon\\s*,\\s*authenticated`,
        "i",
      ),
    );
  });

  it("exposes only the shelter public allowlist", () => {
    expect(sql).toMatch(
      /grant\s+select\s*\(\s*id\s*,\s*name\s*,\s*gu\s*,\s*facility_type\s*,\s*is_im_bank\s*,\s*road_address\s*,\s*location\s*,\s*kma_nx\s*,\s*kma_ny\s*\)\s+on\s+public\.shelters\s+to\s+anon\s*,\s*authenticated/i,
    );
    expect(sql).not.toMatch(/grant[^;]*source_geo_idn[^;]*to\s+anon/i);
    expect(sql).not.toMatch(/grant[^;]*geocode_result[^;]*to\s+anon/i);
  });

  it("keeps reports, access tokens, caches, and jobs server-only", () => {
    for (const table of [
      "shelter_reports",
      "alert_access_tokens",
      "medication_api_cache",
      "attestation_jobs",
      "weather_snapshots",
    ]) {
      expect(sql).not.toMatch(
        new RegExp(
          `grant[\\s\\S]{0,240}on\\s+(?:table\\s+)?public\\.${table}\\s+to\\s+(?:anon|authenticated)`,
          "i",
        ),
      );
    }
  });

  it("uses database profiles and assignment checks for subject access", () => {
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+private\.can_access_subject/i);
    expect(sql).toMatch(/public\.profiles[\s\S]*auth\.uid\s*\(\s*\)/i);
    expect(sql).toMatch(/public\.subject_assignments/i);
    expect(sql).not.toMatch(/user_metadata/i);
  });

  it("hardens SECURITY DEFINER helpers", () => {
    expect(sql).toMatch(/security\s+definer[\s\S]*set\s+search_path\s*=\s*''/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+private\.can_access_subject\s*\(\s*uuid\s*\)\s+from\s+public/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+private\.can_access_subject\s*\(\s*uuid\s*\)\s+to\s+authenticated/i,
    );
  });

  it("creates a private medication image bucket without public reads", () => {
    expect(sql).toMatch(/insert\s+into\s+storage\.buckets[\s\S]*'medication-images'/i);
    expect(sql).toMatch(/'medication-images'[\s\S]*false/i);
    expect(sql).not.toMatch(/create\s+policy[^;]*storage\.objects[^;]*to\s+anon/i);
  });
});
