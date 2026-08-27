import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function migration(name: string): string {
  return readFileSync(resolve(root, "supabase/migrations", name), "utf8");
}

describe("Phase 7 integrity hardening migration", () => {
  const hardening = migration("20260824112000_phase7_integrity_hardening.sql");

  it("suppresses only the superseded medication-confirmation ALERT_SENT shape", () => {
    expect(hardening).toMatch(/before insert on public\.care_events/iu);
    expect(hardening).toMatch(/event_type = 'ALERT_SENT'/iu);
    expect(hardening).toMatch(/idempotency_key like 'medication-confirmation:%'/iu);
    expect(hardening).toMatch(/payload ->> 'reason' = 'MEDICATION_CONFIRMATION'/iu);
    expect(hardening).toMatch(/attestation_state = 'UNVERIFIED'/iu);
  });

  it("keeps attestation targets pending across RETRY_WAIT and fails only final outcomes", () => {
    const phase7 = migration("20260823150548_phase7_alert_attestation.sql");
    expect(phase7).toMatch(/elsif v_kind = 'FAILED' then/iu);
    expect(hardening).toMatch(/deferrable initially deferred/iu);
    expect(hardening).toMatch(/when \(new\.state = 'RETRY_WAIT'\)/iu);
    expect(hardening).toMatch(/set attestation_state = 'PENDING'/iu);
  });

  it("does not coerce unknown crowd data into a false EAS value", () => {
    expect(hardening).toMatch(/report\.crowd_level is null/iu);
    expect(hardening).toMatch(/new\.state := 'FAILED'/iu);
    expect(hardening).toMatch(/CROWD_NOT_PROVIDED/iu);
  });

  it("provides bounded lease-based claim and finalize RPCs for verified check-in recomputes", () => {
    expect(hardening).toMatch(/create or replace function public\.claim_risk_recompute_queue/iu);
    expect(hardening).toMatch(/p_limit is null/iu);
    expect(hardening).toMatch(/for update skip locked/iu);
    expect(hardening).toMatch(/create or replace function public\.finalize_risk_recompute_queue/iu);
    expect(hardening).toMatch(/processed_at = p_completed_at/iu);
    expect(hardening).toMatch(/to service_role/iu);
  });
});
