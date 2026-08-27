import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function loadMigration(): string {
  const directory = resolve(process.cwd(), "supabase/migrations");
  const name = readdirSync(directory).find((entry) =>
    entry.endsWith("_medication_image_cleanup_intents.sql"),
  );
  expect(name, "medication image cleanup migration must exist").toBeTruthy();
  return readFileSync(resolve(directory, name!), "utf8");
}

function loadPgTap(): string {
  return readFileSync(
    resolve(process.cwd(), "supabase/tests/phase8/01_medication_image_cleanup.sql"),
    "utf8",
  );
}

describe("medication image cleanup intent migration", () => {
  it("persists service-role-only cleanup jobs before Storage upload", () => {
    const sql = loadMigration();

    expect(sql).toMatch(/create table public\.medication_image_cleanup_jobs/iu);
    expect(sql).toMatch(
      /'PREPARED'[\s\S]*'DELETE_PENDING'[\s\S]*'PROCESSING'[\s\S]*'RETRY_WAIT'/iu,
    );
    expect(sql).toMatch(/enable row level security/iu);
    expect(sql).toMatch(
      /revoke all on table public\.medication_image_cleanup_jobs[\s\S]*public, anon, authenticated/iu,
    );
    expect(sql).toMatch(
      /grant all on table public\.medication_image_cleanup_jobs to service_role/iu,
    );
    expect(sql).toMatch(
      /v_invalid_path_count[\s\S]*legacy image path\(s\) outside the managed UUID namespace/iu,
    );
    expect(sql).toMatch(/function public\.prepare_medication_image_cleanup/iu);
    expect(sql).toMatch(/revoke all on function public\.prepare_medication_image_cleanup/iu);
  });

  it("attaches new sessions and retake replacements in locked transactions", () => {
    const sql = loadMigration();

    expect(sql).toMatch(/function public\.attach_medication_image_session/iu);
    expect(sql).toMatch(/insert into public\.medication_scan_sessions/iu);
    expect(sql).toMatch(/function public\.replace_medication_image_session/iu);
    expect(sql).toMatch(/for update/iu);
    expect(sql).toMatch(/v_scan\.status <> 'NEEDS_RETAKE'/iu);
    expect(sql).toMatch(/state = 'DELETE_PENDING'/iu);
    expect(sql).toMatch(/image_purge_state = 'PENDING'/iu);
    expect(sql).toMatch(/alter column image_purge_state set default 'NOT_APPLICABLE'/iu);
    expect(sql).toMatch(
      /v_scan\.status = 'UPLOADED'[\s\S]*v_scan\.image_path = p_new_image_path[\s\S]*return p_expected_attempt_count/iu,
    );
  });

  it("leases due jobs with an ABA-safe token and retries with bounded exponential backoff", () => {
    const sql = loadMigration();

    expect(sql).toMatch(/function public\.claim_medication_image_cleanups/iu);
    expect(sql).toMatch(/for update skip locked/iu);
    expect(sql).toMatch(/state in \('PREPARED', 'DELETE_PENDING', 'RETRY_WAIT'\)/iu);
    expect(sql).toMatch(/lease_token = gen_random_uuid\(\)/iu);
    expect(sql).toMatch(/function public\.finalize_medication_image_cleanup/iu);
    expect(sql).toMatch(/job\.lease_token = p_lease_token/iu);
    expect(sql).toMatch(/p_error_code is null or p_error_code !~/iu);
    expect(sql).toMatch(/least\(21600, 60 \* \(2 \^/iu);
    expect(sql).toMatch(
      /if p_deleted then[\s\S]*delete from public\.medication_image_cleanup_jobs/iu,
    );
    expect(sql).toMatch(
      /image_purge_state = 'PROCESSING'[\s\S]*image_purge_state = 'RETRY_WAIT'/iu,
    );
  });

  it("preserves the 24-hour current-session purge and restricts every RPC", () => {
    const sql = loadMigration();

    expect(sql).toMatch(/cleanup_after = p_attached_at \+ interval '24 hours'/iu);
    expect(sql).toMatch(/cleanup_after = p_replaced_at \+ interval '24 hours'/iu);
    expect(sql).toMatch(/image_deleted_at = p_now/iu);
    expect(sql).toMatch(/image_path = null/iu);
    for (const name of [
      "prepare_medication_image_cleanup",
      "attach_medication_image_session",
      "replace_medication_image_session",
      "claim_medication_image_cleanups",
      "finalize_medication_image_cleanup",
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}`, "iu"));
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to service_role`, "iu"),
      );
    }
  });

  it("ships rollback-only PostgreSQL behavior coverage for idempotency, leases, and retries", () => {
    const sql = loadPgTap();

    expect(sql).toMatch(/^begin;/iu);
    expect(sql).toMatch(/prepare_medication_image_cleanup/iu);
    expect(sql).toMatch(/replace_medication_image_session/iu);
    expect(sql).toMatch(/'IDEMPOTENT'/iu);
    expect(sql).toMatch(/'LEASE_LOST'/iu);
    expect(sql).toMatch(/'RETRY_WAIT'/iu);
    expect(sql).toMatch(/has_function_privilege/iu);
    expect(sql).toMatch(/select \* from finish\(\);/iu);
    expect(sql.trimEnd()).toMatch(/rollback;$/iu);
  });
});
