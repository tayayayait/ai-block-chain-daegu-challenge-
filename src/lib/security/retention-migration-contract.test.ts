import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260824110000_phase8_retention.sql",
);
const imageMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260824113000_medication_image_cleanup_intents.sql",
);
const pgTapPath = resolve(process.cwd(), "supabase/tests/phase8/00_retention.sql");

function loadRequired(path: string): string {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8");
}

describe("Phase 8 retention migration", () => {
  it("provides one bounded service-role-only cleanup boundary", () => {
    const sql = loadRequired(migrationPath);

    expect(sql).toMatch(
      /create or replace function public\.run_retention_cleanup\(\s*p_now timestamptz,\s*p_batch_limit integer\s*\)/iu,
    );
    expect(sql).toMatch(/returns jsonb[\s\S]*security definer[\s\S]*set search_path = ''/iu);
    expect(sql).toMatch(/p_batch_limit is null/iu);
    expect(sql).toMatch(/p_batch_limit not between 1 and 500/iu);
    expect(sql.match(/for update skip locked/giu)?.length).toBeGreaterThanOrEqual(7);
    expect(sql.match(/limit p_batch_limit/giu)?.length).toBeGreaterThanOrEqual(7);
    expect(sql).toMatch(/revoke all on function public\.run_retention_cleanup/iu);
    expect(sql).toMatch(
      /grant execute on function public\.run_retention_cleanup\(timestamptz, integer\)[\s\S]*to service_role/iu,
    );
  });

  it("cleans expired access grants, sessions, and route cache entries", () => {
    const sql = loadRequired(migrationPath);

    for (const table of ["alert_access_tokens", "alert_access_sessions", "route_cache"]) {
      expect(sql).toMatch(new RegExp(`delete from public\\.${table}`, "iu"));
    }
    expect(sql.match(/expires_at <= p_now/giu)?.length).toBeGreaterThanOrEqual(3);
  });

  it("claims due image paths and scrubs metadata only after confirmed Storage deletion", () => {
    const sql = loadRequired(imageMigrationPath);
    const baseSql = loadRequired(migrationPath);

    expect(sql).toMatch(/create or replace function public\.claim_medication_image_cleanups/iu);
    expect(sql).toMatch(/image_purge_state = 'PROCESSING'/iu);
    expect(sql).toMatch(/create or replace function public\.finalize_medication_image_cleanup/iu);
    expect(sql).toMatch(/if p_deleted then[\s\S]*image_path = null/iu);
    expect(sql).toMatch(/purge_after <= p_now/iu);
    expect(sql).toMatch(/image_deleted_at = p_now/iu);
    expect(sql).toMatch(/image_purge_state = 'RETRY_WAIT'/iu);
    expect(sql).not.toMatch(/(?:delete|update|insert)\s+(?:from\s+|into\s+)?storage\./iu);
    expect(baseSql).toMatch(/medication_scan_image_path_by_method/iu);
  });

  it("also expires medication API cache and completed recompute queue rows", () => {
    const sql = loadRequired(migrationPath);

    expect(sql).toMatch(/delete from public\.medication_api_cache/iu);
    expect(sql).toMatch(/select cache\.api_kind,\s*cache\.request_hash/iu);
    expect(sql).toMatch(
      /cache\.api_kind = due\.api_kind\s+and cache\.request_hash = due\.request_hash/iu,
    );
    expect(sql).not.toMatch(/medication_api_cache[\s\S]{0,500}cache\.cache_key/iu);
    expect(sql).toMatch(/delete from public\.risk_recompute_queue/iu);
    expect(sql).toMatch(/processed_at <= p_now - interval '30 days'/iu);
  });

  it("expires notifications while retaining every terminal attestation receipt", () => {
    const sql = loadRequired(migrationPath);

    expect(sql).toMatch(/delete from public\.guardian_alerts/iu);
    expect(sql).toMatch(/'DEMO_RECORDED'[\s\S]*'DELIVERED'[\s\S]*'FAILED_PERMANENT'/iu);
    expect(sql).toMatch(/updated_at <= p_now - interval '90 days'/iu);
    expect(sql).not.toMatch(/delete from public\.attestation_jobs/iu);
    expect(sql).toMatch(/CONFIRMATION_UNCERTAIN/iu);
    expect(sql).toMatch(/v_attestation_jobs integer := 0/iu);
  });

  it("ships a rollback-only pgTAP authorization and bounded-deletion suite", () => {
    const source = loadRequired(pgTapPath);

    expect(source).toMatch(/^begin;/iu);
    expect(source).toMatch(/select\s+plan\s*\(\s*\d+\s*\)/iu);
    expect(source).toMatch(/set local role authenticated[\s\S]*throws_ok/iu);
    expect(source).toMatch(/set local role service_role[\s\S]*lives_ok/iu);
    expect(source).toMatch(/run_retention_cleanup/iu);
    expect(source).toMatch(/results_eq/iu);
    expect(source).toMatch(/select\s+\*\s+from\s+finish\s*\(\s*\)/iu);
    expect(source.trimEnd()).toMatch(/rollback;$/iu);
  });
});
