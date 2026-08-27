import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260824115000_phase7_attestation_dedup_hardening.sql",
  ),
  "utf8",
);

function functionBody(name: string): string {
  const start = sql.indexOf(`function public.${name}`);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end + 3);
}

describe("attestation dedup hardening migration", () => {
  it("allows only one durable job for each attestation target", () => {
    for (const target of ["care_event_id", "shelter_report_id", "shelter_checkin_id"]) {
      expect(sql).toMatch(
        new RegExp(
          `create\\s+unique\\s+index[\\s\\S]*?on\\s+public\\.attestation_jobs\\s*\\(\\s*${target}\\s*\\)[\\s\\S]*?where\\s+${target}\\s+is\\s+not\\s+null`,
          "iu",
        ),
      );
    }
    expect(sql).toMatch(/duplicate attestation targets require manual review/iu);
  });

  it("does not enqueue or reclaim an already VERIFIED check-in", () => {
    const createCheckIn = functionBody("create_pending_shelter_checkin");
    const claim = functionBody("claim_attestation_jobs");

    expect(createCheckIn).toMatch(
      /if\s+stored\.attestation_state\s*<>\s*'VERIFIED'\s+then[\s\S]*insert\s+into\s+public\.attestation_jobs/iu,
    );
    expect(createCheckIn).toMatch(
      /when\s+stored\.attestation_state\s*=\s*'VERIFIED'[\s\S]*then\s+'VERIFIED'/iu,
    );
    expect(claim).toMatch(/TARGET_ALREADY_VERIFIED/iu);
    expect(claim.match(/attestation_state\s*=\s*'VERIFIED'/giu)).toHaveLength(6);
    expect(claim.match(/attestation_state\s*<>\s*'VERIFIED'/giu)).toHaveLength(3);
  });

  it("suppresses only the exact legacy unverified fake medication alert shape", () => {
    const guard = functionBody("reject_unverified_medication_alert_sent");
    expect(guard).toMatch(/event_type\s*=\s*'ALERT_SENT'/iu);
    expect(guard).toMatch(/medication-confirmation:%/iu);
    expect(guard).toMatch(/attestation_state\s*=\s*'UNVERIFIED'/iu);
    expect(guard).toMatch(/attestation_uid\s+is\s+null/iu);
  });

  it("keeps RPCs service-role only with fixed search paths", () => {
    for (const name of ["create_pending_shelter_checkin", "claim_attestation_jobs"]) {
      expect(functionBody(name)).toMatch(/security\s+definer[\s\S]*set\s+search_path\s*=\s*''/iu);
    }
    expect(sql).toMatch(/revoke\s+all[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated/iu);
    expect(sql).toMatch(/grant\s+execute[\s\S]*to\s+service_role/iu);
  });
});
