import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260823130631_phase5_shelter_search_and_reports.sql",
);
const sql = readFileSync(migrationPath, "utf8");

function functionBody(name: string): string {
  const start = sql.indexOf(`function public.${name}`);
  const next = sql.indexOf("create or replace function", start + 1);
  return sql.slice(start, next === -1 ? undefined : next);
}

describe("Phase 5 shelter migration contract", () => {
  it("uses an indexed geography radius query with hard radius and result caps", () => {
    const search = functionBody("search_shelters");

    expect(search).toMatch(/extensions\.st_dwithin\s*\(/i);
    expect(search).toMatch(/extensions\.st_distance\s*\(/i);
    expect(search).toMatch(/500[\s\S]*1000[\s\S]*3000/);
    expect(search).toMatch(/least\s*\(\s*p_limit\s*,\s*100\s*\)/i);
    expect(search).toMatch(/p_im_bank_only\s+is\s+null/i);
    expect(search).toMatch(/p_open_state\s+is\s+null/i);
    expect(search).toMatch(/p_sort\s+is\s+null/i);
  });

  it("uses only the newest report and makes status unknown after two hours", () => {
    const search = functionBody("search_shelters");

    expect(search).toMatch(/order\s+by[\s\S]*observed_at\s+desc[\s\S]*limit\s+1/i);
    expect(search).toMatch(/interval\s+'2 hours'/i);
    expect(search).toMatch(/'UNKNOWN'/i);
  });

  it("prioritizes a verified open shelter within 500m before distance", () => {
    const search = functionBody("search_shelters");

    expect(search).toMatch(/'OPEN'[\s\S]*'VERIFIED'[\s\S]*distance_m\s*<=\s*500/i);
    expect(search).toMatch(/order\s+by[\s\S]*priority_rank[\s\S]*distance_m/i);
  });

  it("keeps both RPCs service-role only with fixed search paths", () => {
    for (const name of ["search_shelters", "get_shelter_by_id", "submit_shelter_report"]) {
      const body = functionBody(name);
      expect(body).toMatch(/security\s+invoker/i);
      expect(body).toMatch(/set\s+search_path\s*=\s*''/i);
      expect(sql).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\([^;]+from\\s+public`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]+to\\s+service_role`,
          "i",
        ),
      );
      expect(sql).not.toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]+to\\s+(?:anon|authenticated)`,
          "i",
        ),
      );
    }
  });

  it("serializes reporter mutations and enforces duplicate plus rate windows atomically", () => {
    const submit = functionBody("submit_shelter_report");

    expect(submit).toMatch(/pg_advisory_xact_lock/i);
    expect(submit).toMatch(/reporter_hash[\s\S]*shelter_id[\s\S]*interval\s+'10 minutes'/i);
    expect(submit).toMatch(/RATE_LIMITED/);
    expect(submit).toMatch(/retry_after/i);
  });

  it("creates an unverified report and a pending attestation job without check-in or HRI writes", () => {
    const submit = functionBody("submit_shelter_report");

    expect(submit).toMatch(/insert\s+into\s+public\.shelter_reports/i);
    expect(submit).toMatch(/'UNVERIFIED'/i);
    expect(submit).toMatch(/insert\s+into\s+public\.attestation_jobs/i);
    expect(submit).toMatch(/'PENDING'/i);
    expect(submit).not.toMatch(
      /insert\s+into\s+public\.(?:shelter_checkins|risk_snapshots|care_events)/i,
    );
    expect(submit).not.toMatch(/\b(?:ip|ip_address|cookie)\b/i);
  });

  it("removes direct anonymous table access so the server DTO is the only public read boundary", () => {
    expect(sql).toMatch(/drop\s+policy\s+if\s+exists\s+shelters_public_read/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+public\.shelters\s+from\s+anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+public\.shelter_reports\s+from\s+anon\s*,\s*authenticated/i,
    );
  });
});
