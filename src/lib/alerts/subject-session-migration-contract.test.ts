import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260824114000_phase7_alert_subject_scope.sql"),
  "utf8",
);

describe("alert subject session migration contract", () => {
  it("resolves only a live, unrevoked alert session to the minimum subject scope", () => {
    const resultShape = sql.slice(sql.indexOf("returns table"), sql.indexOf("language plpgsql"));
    expect(resultShape).toMatch(
      /returns\s+table\s*\(\s*session_id\s+uuid\s*,\s*subject_id\s+uuid\s*,\s*expires_at\s+timestamptz\s*\)/iu,
    );
    expect(sql).toMatch(/session_hash\s*=\s*p_session_hash/iu);
    expect(sql).toMatch(/revoked_at\s+is\s+null/iu);
    expect(sql).toMatch(/expires_at\s*>\s*p_now/iu);
    expect(sql).toMatch(/guardian_alert\.id\s*=\s*access_session\.alert_id/iu);
    expect(resultShape).not.toMatch(/event_id|alert_id|phone|latitude|longitude/iu);
  });

  it("is fixed-search-path and service-role only", () => {
    expect(sql).toMatch(/security\s+definer[\s\S]*set\s+search_path\s*=\s*''/iu);
    expect(sql).toMatch(/revoke\s+all[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated/iu);
    expect(sql).toMatch(/grant\s+execute[\s\S]*to\s+service_role/iu);
  });
});
