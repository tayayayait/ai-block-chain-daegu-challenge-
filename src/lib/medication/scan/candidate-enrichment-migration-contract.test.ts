import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const directory = resolve(process.cwd(), "supabase/migrations");
  const matches = readdirSync(directory).filter((name) =>
    name.endsWith("_atomic_medication_candidate_enrichment.sql"),
  );
  expect(matches).toHaveLength(1);
  return readFileSync(resolve(directory, matches[0]!), "utf8");
}

describe("atomic medication candidate enrichment migration", () => {
  it("locks one open review and replaces only an unchanged target candidate", () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /function public\.replace_medication_review_candidate\(p_command jsonb\)/iu,
    );
    expect(sql).toMatch(/security invoker/iu);
    expect(sql).toMatch(/set search_path = ''/iu);
    expect(sql).toMatch(/current_user <> 'service_role'/iu);
    expect(sql).toMatch(/for update/iu);
    expect(sql).toMatch(/expected_candidate/iu);
    expect(sql).toMatch(/with ordinality/iu);
    expect(sql).toMatch(/jsonb_agg\([\s\S]*order by/iu);
  });

  it("exposes the mutation to service_role only", () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /revoke all on function public\.replace_medication_review_candidate\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/iu,
    );
    expect(sql).toMatch(
      /grant execute on function public\.replace_medication_review_candidate\(jsonb\)[\s\S]*to service_role/iu,
    );
  });

  it("rejects nullable enum fields and malformed MFDS evidence at the database boundary", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/jsonb_typeof\(v_replacement_candidate -> 'source'\) <> 'string'/iu);
    expect(sql).toMatch(
      /jsonb_typeof\(v_replacement_candidate -> 'evidenceSource'\) <> 'string'/iu,
    );
    expect(sql).toMatch(/\(v_replacement_candidate -> 'mfds'\) \?& array\[/iu);
    expect(sql).toMatch(/pillIdentification/iu);
    expect(sql).toMatch(/easyDrug/iu);
    expect(sql).toMatch(/dur/iu);
  });
});
