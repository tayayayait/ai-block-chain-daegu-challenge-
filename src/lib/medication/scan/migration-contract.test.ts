import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260823131128_add_medication_scan_confirmation.sql",
);

describe("Phase 4 medication confirmation migration", () => {
  it("stores only safe review payloads and server-only idempotency receipts", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/add column candidate_payload jsonb/iu);
    expect(sql).toMatch(/create table public\.medication_confirmation_receipts/iu);
    expect(sql).toMatch(/request_id uuid primary key/iu);
    expect(sql).toMatch(/enable row level security/iu);
    expect(sql).toMatch(/revoke all on table public\.medication_confirmation_receipts/iu);
    expect(sql).toMatch(
      /grant all on table public\.medication_confirmation_receipts to service_role/iu,
    );
  });

  it("uses one locked security-definer RPC for medication policy, HRI, and transition", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/function public\.confirm_medication_scan\(p_command jsonb\)/iu);
    expect(sql).toMatch(/security definer/iu);
    expect(sql).toMatch(/set search_path = ''/iu);
    expect(sql).toMatch(/pg_advisory_xact_lock/iu);
    expect(sql).toMatch(/when 'REPLACE' then[\s\S]*delete from public\.medications/iu);
    expect(sql).toMatch(/insert into public\.risk_snapshots/iu);
    expect(sql).toMatch(/insert into public\.alert_transitions/iu);
    expect(sql).toMatch(/on conflict \(idempotency_key\) do nothing/iu);
    expect(sql).toMatch(/revoke all on function public\.confirm_medication_scan/iu);
    expect(sql).toMatch(
      /grant execute on function public\.confirm_medication_scan\(jsonb\)[\s\S]*to service_role/iu,
    );
  });
});
