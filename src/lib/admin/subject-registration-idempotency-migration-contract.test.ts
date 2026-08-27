import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function hardeningMigration(): string {
  const directory = resolve(process.cwd(), "supabase/migrations");
  const files = readdirSync(directory).filter((name) =>
    name.endsWith("_harden_real_subject_registration_idempotency.sql"),
  );
  expect(files).toHaveLength(1);
  return readFileSync(resolve(directory, files[0]!), "utf8");
}

describe("real subject registration idempotency migration", () => {
  it("serializes each request and returns its durable subject receipt", () => {
    const sql = hardeningMigration();

    expect(sql).toMatch(/create table public\.subject_registration_receipts/iu);
    expect(sql).toMatch(/request_id uuid primary key/iu);
    expect(sql).toMatch(/pg_advisory_xact_lock/iu);
    expect(sql).toMatch(/command_hash/iu);
    expect(sql).toMatch(/select[\s\S]*subject_id[\s\S]*for update/iu);
    expect(sql).toMatch(/insert into public\.subject_registration_receipts/iu);
  });

  it("keeps the receipt private and the RPC service-role only", () => {
    const sql = hardeningMigration();

    expect(sql).toMatch(/enable row level security/iu);
    expect(sql).toMatch(
      /revoke all on table public\.subject_registration_receipts from public, anon, authenticated/iu,
    );
    expect(sql).toMatch(
      /revoke all on function public\.register_subject_service_role\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/iu,
    );
    expect(sql).toMatch(
      /grant execute on function public\.register_subject_service_role\(jsonb\)[\s\S]*to service_role/iu,
    );
  });

  it("preserves receipts without blocking deletion of an administrator profile", () => {
    const sql = hardeningMigration();

    expect(sql).toMatch(/actor_profile_id uuid(?! not null)/iu);
    expect(sql).toMatch(
      /references public\.profiles \(organization_id, id\) on delete set null \(actor_profile_id\)/iu,
    );
  });
});
