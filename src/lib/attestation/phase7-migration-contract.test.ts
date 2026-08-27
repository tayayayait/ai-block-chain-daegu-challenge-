import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260823150548_phase7_alert_attestation.sql",
);

const migrationSql = (): string => readFileSync(migrationPath, "utf8");

describe("Phase 7 alert and attestation migration", () => {
  it("stores only hashed one-time grants and sessions and exchanges them atomically", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/alter table public\.alert_access_tokens[\s\S]*add column event_id uuid/iu);
    expect(sql).toMatch(/create table public\.alert_access_sessions/iu);
    expect(sql).toMatch(/session_hash text not null unique[\s\S]*\^\[0-9a-f\]\{64\}\$/iu);
    expect(sql).toMatch(/create or replace function public\.consume_alert_access_token/iu);
    expect(sql).toMatch(
      /exchanged_at is null[\s\S]*for update[\s\S]*insert into public\.alert_access_sessions/iu,
    );
  });

  it("claims notification work with skip locked and rechecks consent immediately before send", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/create table public\.guardian_notification_preferences/iu);
    expect(sql).toMatch(/create or replace function public\.claim_guardian_alert_outbox/iu);
    expect(sql).toMatch(/for update skip locked/iu);
    expect(sql).toMatch(/create or replace function public\.recheck_guardian_alert_eligibility/iu);
    for (const reason of [
      "NO_CONSENT",
      "CONSENT_WITHDRAWN",
      "CHANNEL_BLOCKED",
      "RECIPIENT_UNAVAILABLE",
    ]) {
      expect(sql).toContain(reason);
    }
  });

  it("allows only demo notification outcomes and never creates ALERT_SENT for a demo record", () => {
    const sql = migrationSql();
    const finalizeBody = sql.match(
      /create or replace function public\.finalize_guardian_alert_outbox[\s\S]*?\$\$;/iu,
    )?.[0];

    expect(finalizeBody).toBeDefined();
    expect(finalizeBody).toContain("DEMO_RECORDED");
    expect(finalizeBody).not.toMatch(/insert into public\.care_events/iu);
    expect(finalizeBody).not.toMatch(/when 'ACCEPTED'/iu);
    expect(finalizeBody).not.toMatch(/when 'DELIVERED'/iu);
  });

  it("claims attestation jobs with leases and atomically applies verified Base Sepolia results", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/create or replace function public\.claim_attestation_jobs/iu);
    expect(sql).toMatch(/create or replace function public\.finalize_attestation_job/iu);
    expect(sql).toMatch(/84532/iu);
    expect(sql).toMatch(/attestation_state = 'VERIFIED'/iu);
    expect(sql).toMatch(/insert into public\.risk_recompute_queue/iu);
  });

  it("keeps worker state server-only and grants every privileged RPC only to service_role", () => {
    const sql = migrationSql();

    for (const table of [
      "guardian_notification_preferences",
      "alert_access_sessions",
      "risk_recompute_queue",
    ]) {
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table} force row level security`, "iu"),
      );
      expect(sql).toMatch(
        new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "iu"),
      );
    }
    for (const functionName of [
      "consume_alert_access_token",
      "claim_guardian_alert_outbox",
      "recheck_guardian_alert_eligibility",
      "finalize_guardian_alert_outbox",
      "claim_attestation_jobs",
      "finalize_attestation_job",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}[\\s\\S]*to service_role`,
          "iu",
        ),
      );
    }
  });
});
