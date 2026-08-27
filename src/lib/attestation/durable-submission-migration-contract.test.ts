import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260824173000_phase7_durable_attestation_submission.sql",
);

const migrationSql = (): string => readFileSync(migrationPath, "utf8");

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create function public.${name}`);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end + 3);
}

describe("Phase 7 durable attestation submission migration", () => {
  it("adds an unpredictable claim owner and durable submission timestamps", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/add column claim_token uuid/iu);
    expect(sql).toMatch(/add column submission_started_at timestamptz/iu);
    expect(sql).toMatch(/add column submitted_at timestamptz/iu);
    expect(functionBody(sql, "claim_attestation_jobs")).toMatch(
      /claim_token\s*=\s*gen_random_uuid\(\)/iu,
    );
  });

  it("never reclaims an expired job whose broadcast may be unknown", () => {
    const claim = functionBody(migrationSql(), "claim_attestation_jobs");

    expect(claim).toMatch(/submission_started_at\s+is\s+null[\s\S]*transaction_hash\s+is\s+null/iu);
    expect(claim).toMatch(/transaction_hash\s+is\s+not\s+null/iu);
    expect(claim).toMatch(/for update skip locked/iu);
  });

  it("gates broadcast under the active lease and stores the tx hash in a separate RPC", () => {
    const sql = migrationSql();
    const begin = functionBody(sql, "begin_attestation_submission");
    const record = functionBody(sql, "record_attestation_submission");

    expect(begin).toMatch(/v_job\.claim_token\s+is\s+distinct\s+from\s+p_claim_token/iu);
    expect(begin).toMatch(/v_job\.lease_until\s+is\s+distinct\s+from\s+p_expected_lease_until/iu);
    expect(begin).toMatch(/v_job\.lease_until\s*<=\s*p_started_at/iu);
    expect(record).toMatch(/transaction_hash\s*=\s*lower\(p_transaction_hash\)/iu);
    expect(record).toMatch(/submitted_at\s*=\s*p_submitted_at/iu);
  });

  it("requires the claim token and the already stored transaction in finalization", () => {
    const finalize = functionBody(migrationSql(), "finalize_attestation_job");

    expect(finalize).toMatch(/v_job\.claim_token\s+is\s+distinct\s+from\s+p_claim_token/iu);
    expect(finalize).toMatch(
      /v_job\.transaction_hash\s+is\s+distinct\s+from\s+v_transaction_hash/iu,
    );
    expect(finalize).toMatch(/v_job\.schema_uid\s+is\s+distinct\s+from\s+v_schema_uid/iu);
  });

  it("keeps every new RPC service-role only with a fixed search path", () => {
    const sql = migrationSql();
    for (const name of [
      "claim_attestation_jobs",
      "begin_attestation_submission",
      "record_attestation_submission",
      "finalize_attestation_job",
    ]) {
      expect(functionBody(sql, name)).toMatch(/security definer[\s\S]*set search_path = ''/iu);
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to service_role`, "iu"),
      );
    }
  });
});
