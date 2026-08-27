import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260824160017_phase7_notification_delivery_hardening.sql",
  ),
  "utf8",
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end + 3);
}

describe("Phase 7 notification delivery hardening migration", () => {
  it("versions notification consent and requires auditable consent evidence", () => {
    expect(sql).toMatch(/guardian_notification_preferences[\s\S]*revision bigint/iu);
    expect(sql).toMatch(/consent_text_version text/iu);
    expect(sql).toMatch(/consent_source text/iu);
    expect(sql).toMatch(/consent_evidence_id uuid/iu);
    expect(functionBody("private.queue_guardian_alert")).toMatch(
      /consent_revision[\s\S]*preference\.revision/iu,
    );
  });

  it("uses an unpredictable owner token and the exact consent revision for every claim", () => {
    const claim = functionBody("public.claim_guardian_alert_outbox");
    expect(sql).toMatch(/guardian_alerts[\s\S]*claim_token uuid/iu);
    expect(sql).toMatch(/guardian_alerts[\s\S]*consent_revision bigint/iu);
    expect(claim).toMatch(/claim_token\s*=\s*gen_random_uuid\(\)/iu);
    expect(claim).toMatch(/(?:guardian_alert|claimed)\.claim_token/iu);
    expect(claim).toMatch(/(?:guardian_alert|claimed)\.consent_revision/iu);
    expect(claim).toMatch(/for update skip locked/iu);
  });

  it("rechecks an active lease, owner token, recipient, and unchanged consent immediately before send", () => {
    const recheck = functionBody("public.recheck_guardian_alert_eligibility");
    expect(recheck).toMatch(/claim_token\s+is\s+not\s+distinct\s+from\s+p_claim_token/iu);
    expect(recheck).toMatch(/lease_until\s*>\s*p_checked_at/iu);
    expect(recheck).toMatch(
      /(?:consent_revision\s*=\s*p_expected_consent_revision|preferences?\.revision\s+is\s+distinct\s+from\s+p_expected_consent_revision)/iu,
    );
    expect(recheck).toMatch(
      /v_preferences\.revision\s+is\s+distinct\s+from\s+v_alert\.consent_revision/iu,
    );
    expect(recheck).toMatch(/CONSENT_CHANGED/iu);
  });

  it("requires the owner token when finalizing and invalidates sibling access grants atomically", () => {
    const finalize = functionBody("public.finalize_guardian_alert_outbox");
    const replaceGrant = functionBody("public.replace_alert_access_grant");
    expect(finalize).toMatch(/claim_token\s+is\s+distinct\s+from\s+p_claim_token/iu);
    expect(finalize).toMatch(/v_alert\.lease_until\s*<=\s*clock_timestamp\(\)/iu);
    expect(replaceGrant).toMatch(/p_claim_token uuid/iu);
    expect(replaceGrant).toMatch(/p_expected_lease_until timestamptz/iu);
    expect(replaceGrant).toMatch(/p_token_hash is null/iu);
    expect(replaceGrant).toMatch(/p_expires_at is null/iu);
    expect(replaceGrant).toMatch(
      /v_alert\.claim_token\s+is\s+not\s+distinct\s+from\s+p_claim_token/iu,
    );
    expect(replaceGrant).toMatch(/v_alert\.lease_until\s*>\s*clock_timestamp\(\)/iu);
    expect(replaceGrant).toMatch(/update public\.alert_access_tokens[\s\S]*revoked_at/iu);
    expect(replaceGrant).toMatch(/exchanged_at is null/iu);
    expect(replaceGrant).toMatch(/insert into public\.alert_access_tokens/iu);
  });

  it("keeps every new or replaced RPC service-role only with a fixed search path", () => {
    for (const name of [
      "public.claim_guardian_alert_outbox",
      "public.recheck_guardian_alert_eligibility",
      "public.finalize_guardian_alert_outbox",
      "public.replace_alert_access_grant",
    ]) {
      expect(functionBody(name)).toMatch(/security definer[\s\S]*set search_path = ''/iu);
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function ${name.replace(".", "\\.")}[\\s\\S]*to service_role`,
          "iu",
        ),
      );
    }
  });
});
