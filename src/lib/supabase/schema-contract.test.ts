import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const phase2MigrationNames = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .slice(0, 3);
const sql = phase2MigrationNames
  .map((file) => readFileSync(resolve(migrationsDirectory, file), "utf8"))
  .join("\n");

const REQUIRED_TABLES = [
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

describe("Phase 2 core schema migration", () => {
  it.each(REQUIRED_TABLES)("creates public.%s", (table) => {
    expect(sql).toMatch(new RegExp(`create\\s+table\\s+public\\.${table}\\b`, "i"));
  });

  it("keeps PostGIS types schema-qualified and separates 500m observation keys", () => {
    expect(sql).toMatch(/extensions\.geography\s*\(\s*point\s*,\s*4326\s*\)/i);
    expect(sql).toMatch(/weather_snapshots[\s\S]*location_key\s+text\s+not\s+null/i);
    expect(sql).toMatch(/weather_snapshots[\s\S]*kma_nx\s+smallint/i);
    expect(sql).toMatch(/weather_snapshots[\s\S]*kma_ny\s+smallint/i);
  });

  it("uses the normative transition kinds and treats re-entry as a new ENTER episode", () => {
    expect(sql).toMatch(/'ENTER'[\s\S]*'ESCALATE'[\s\S]*'PERSIST_2H'/);
    expect(sql).not.toContain("REENTER");
  });

  it("enforces numeric bounds, idempotency, and verified UID invariants", () => {
    expect(sql).toMatch(/hri\s+between\s+0\s+and\s+100/i);
    expect(sql).toMatch(/crowd_level\s+between\s+0\s+and\s+2/i);
    expect(sql).toMatch(/confidence\s+between\s+0(?:\.0)?\s+and\s+1(?:\.0)?/i);
    expect(sql).toMatch(/unique\s*\(\s*subject_id\s*,\s*bucket_start\s*,\s*input_hash\s*\)/i);
    expect(sql).toMatch(/hri\s*=\s*greatest\([\s\S]*-\s*\(breakdown\s*->>\s*'C'\)/i);
    expect(sql).toMatch(
      /attestation_state\s*<>\s*'VERIFIED'[\s\S]*attestation_uid\s+is\s+not\s+null/i,
    );
  });

  it("binds an attestation job to exactly one relational target", () => {
    expect(sql).toMatch(
      /num_nonnulls\s*\([\s\S]*care_event_id[\s\S]*shelter_report_id[\s\S]*shelter_checkin_id[\s\S]*\)\s*=\s*1/i,
    );
  });

  it("does not create Phase 6 spatial tables inside the Phase 2 migration set", () => {
    for (const deferred of ["buildings", "rest_spots", "barrier_segments", "route_cache"]) {
      expect(sql).not.toMatch(new RegExp(`create\\s+table\\s+public\\.${deferred}\\b`, "i"));
    }
  });

  it("never derives authorization from mutable user metadata", () => {
    expect(sql).not.toMatch(/user_metadata/i);
  });
});
