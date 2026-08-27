import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const databaseTestsDirectory = resolve(process.cwd(), "supabase/tests/database");

function databaseTestSource(file: string) {
  return readFileSync(resolve(databaseTestsDirectory, file), "utf8");
}

describe("Phase 2 pgTAP database tests", () => {
  it("ships deterministic structure and authorization suites", () => {
    expect(readdirSync(databaseTestsDirectory).sort()).toEqual([
      "00_structure_and_privileges.sql",
      "01_rls_behavior.sql",
      "02_phase5_shelter_reports.sql",
      "03_weather_collection_history.sql",
      "04_real_subject_registration.sql",
      "05_atomic_medication_candidate_enrichment.sql",
      "06_subject_registration_idempotency.sql",
    ]);
  });

  it.each([
    "00_structure_and_privileges.sql",
    "01_rls_behavior.sql",
    "02_phase5_shelter_reports.sql",
    "03_weather_collection_history.sql",
    "04_real_subject_registration.sql",
    "05_atomic_medication_candidate_enrichment.sql",
    "06_subject_registration_idempotency.sql",
  ])("wraps %s in a rollback-only pgTAP transaction", (file) => {
    const source = databaseTestSource(file);

    expect(source).toMatch(/^begin;/i);
    expect(source).toMatch(/select\s+plan\s*\(\s*\d+\s*\)\s*;/i);
    expect(source).toMatch(/select\s+\*\s+from\s+finish\s*\(\s*\)\s*;/i);
    expect(source.trimEnd()).toMatch(/rollback;$/i);
  });

  it("tests every public table for RLS and service-role access", () => {
    const source = databaseTestSource("00_structure_and_privileges.sql");
    const tables = [
      "organizations",
      "profiles",
      "subjects",
      "subject_assignments",
      "subject_registration_receipts",
      "shelters",
      "medication_scan_sessions",
      "medication_image_cleanup_jobs",
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

    for (const table of tables) {
      expect(source).toContain(`'${table}'`);
    }
    expect(source).toMatch(/relrowsecurity/i);
    expect(source).toMatch(/relforcerowsecurity/i);
    expect(source).toMatch(/policies_are\s*\(/i);
    expect(source).toMatch(/has_table_privilege\s*\(\s*'service_role'/i);
  });

  it("moves public shelter reads to the server DTO and denies sensitive tables", () => {
    const structure = databaseTestSource("00_structure_and_privileges.sql");
    const behavior = databaseTestSource("01_rls_behavior.sql");

    expect(structure).toMatch(/information_schema\.column_privileges/i);
    expect(structure).toMatch(/source_geo_idn/i);
    expect(behavior).toMatch(/set\s+local\s+role\s+anon/i);
    expect(behavior).toMatch(/throws_ok/i);
    expect(behavior).toMatch(/medication_api_cache/i);
    expect(structure).toMatch(/medication_image_cleanup_jobs/i);
    expect(behavior).toMatch(/alert_access_tokens/i);
    expect(behavior).toMatch(/attestation_jobs/i);
  });

  it("covers Phase 5 PostGIS status and atomic anonymous report behavior", () => {
    const source = databaseTestSource("02_phase5_shelter_reports.sql");

    expect(source).toMatch(/search_shelters/i);
    expect(source).toMatch(/submit_shelter_report/i);
    expect(source).toMatch(/'UNKNOWN'/i);
    expect(source).toMatch(/'DUPLICATE'/i);
    expect(source).toMatch(/'RATE_LIMITED'/i);
    expect(source).toMatch(/shelter_checkins/i);
  });

  it("covers append-only weather collections and exact-attempt idempotency", () => {
    const source = databaseTestSource("03_weather_collection_history.sql");

    expect(source).toMatch(/collected_at/iu);
    expect(source).toMatch(/array\[2::bigint\]/iu);
    expect(source).toMatch(/23505/u);
  });

  it("keeps real subject registration ADMIN-only and atomic", () => {
    const source = databaseTestSource("04_real_subject_registration.sql");

    expect(source).toMatch(/register_subject_service_role/iu);
    expect(source).toMatch(/has_function_privilege/iu);
    expect(source).toMatch(/CARE_WORKER/iu);
    expect(source).toMatch(/subject_assignments/iu);
    expect(source).toMatch(/거부 대상자/iu);
  });

  it("covers atomic MFDS candidate replacement and retry-safe subject registration", () => {
    const medication = databaseTestSource("05_atomic_medication_candidate_enrichment.sql");
    const registration = databaseTestSource("06_subject_registration_idempotency.sql");

    expect(medication).toMatch(/replace_medication_review_candidate/iu);
    expect(medication).toMatch(/stale response/iu);
    expect(medication).toMatch(/array\['A1\|B1'\]/u);
    expect(registration).toMatch(/registration_request_id/iu);
    expect(registration).toMatch(/registration request already used/iu);
    expect(registration).toMatch(/array\[1::bigint\]/u);
  });

  it("uses fixed auth users and JWT claims for organization/assignment isolation", () => {
    const source = databaseTestSource("01_rls_behavior.sql");

    expect(source).toMatch(/insert\s+into\s+auth\.users/i);
    expect(source).toMatch(/00000000-0000-4000-8000-00000000a001/i);
    expect(source).toMatch(/set\s+local\s+request\.jwt\.claim\.sub\s*=\s*'[^']+'/i);
    expect(source).toMatch(/set\s+local\s+role\s+authenticated/i);
    expect(source).toMatch(/set\s+local\s+role\s+service_role/i);
    expect(source).not.toMatch(/user_metadata/i);
  });

  it("covers live success, expected rejection, grants, and constraints", () => {
    const source = databaseTestSource("01_rls_behavior.sql");

    expect(source).toMatch(/lives_ok/i);
    expect(source).toMatch(/throws_ok/i);
    expect(source).toMatch(/results_eq/i);
    expect(source).toMatch(/23503/);
    expect(source).toMatch(/23514/);
  });
});
