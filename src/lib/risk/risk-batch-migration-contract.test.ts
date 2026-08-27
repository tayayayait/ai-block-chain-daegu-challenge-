import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260823213500_add_risk_batch_state.sql",
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("Phase 3 risk episode and acknowledgement migration", () => {
  it("stores one active episode per subject and connects transitions to it", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/create table public\.risk_episodes/iu);
    expect(sql).toMatch(
      /create unique index risk_episodes_one_active_subject_idx[\s\S]*where ended_at is null/iu,
    );
    expect(sql).toMatch(
      /alter table public\.alert_transitions[\s\S]*foreign key \(episode_id, subject_id\)[\s\S]*references public\.risk_episodes \(id, subject_id\)/iu,
    );
    expect(sql).toMatch(
      /alter table public\.care_events[\s\S]*add column alert_transition_id uuid[\s\S]*references public\.alert_transitions/iu,
    );
    expect(sql).toMatch(
      /create unique index care_events_alert_transition_idx[\s\S]*where alert_transition_id is not null/iu,
    );
  });

  it("stores dashboard acknowledgement per profile and transition", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/create table public\.alert_transition_acknowledgements/iu);
    expect(sql).toMatch(/primary key \(alert_transition_id, profile_id\)/iu);
    expect(sql).toMatch(/alert_transition_acknowledgements[\s\S]*enable row level security/iu);
    expect(sql).toMatch(
      /create policy alert_transition_ack_read_permitted[\s\S]*private\.can_access_subject/iu,
    );
    expect(sql).toMatch(
      /create policy alert_transition_ack_insert_self[\s\S]*profile_id = \(select auth\.uid\(\)\)/iu,
    );
  });

  it("keeps batch execution summaries server-only and explicitly grants service_role", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/create table public\.risk_batch_runs/iu);
    expect(sql).toMatch(/failed_subjects integer not null/iu);
    expect(sql).toMatch(/duplicate_snapshots integer not null/iu);
    expect(sql).toMatch(/transition_count integer not null/iu);
    expect(sql).toMatch(
      /revoke all on table public\.risk_batch_runs from public, anon, authenticated/iu,
    );
    expect(sql).toMatch(/grant all on table[\s\S]*public\.risk_batch_runs[\s\S]*to service_role/iu);
    expect(sql).not.toMatch(/grant (?:select|insert|update|delete).*risk_batch_runs to anon/iu);
  });

  it("exposes only service-role RPCs for private inputs, history, atomic commit, and lease locking", () => {
    const sql = migrationSql();

    for (const functionName of [
      "load_risk_subject_core",
      "load_risk_history",
      "commit_risk_computation",
      "try_acquire_risk_batch_lock",
      "release_risk_batch_lock",
    ]) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${functionName}`, "iu"));
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${functionName}\\([\\s\\S]*?from public`, "iu"),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role`,
          "iu",
        ),
      );
    }
    expect(sql).toMatch(
      /create or replace function public\.commit_risk_computation[\s\S]*security definer[\s\S]*set search_path = ''/iu,
    );
    expect(sql).toMatch(/pg_advisory_xact_lock/iu);
    expect(sql).toMatch(/create table public\.risk_batch_locks/iu);
    expect(sql).toMatch(/lease_until timestamptz not null/iu);
  });

  it("loads the complete HRI input window without exposing it to session roles", () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /load_risk_subject_core[\s\S]*birth_year[\s\S]*lives_alone[\s\S]*chronic_disease[\s\S]*has_cooling/iu,
    );
    expect(sql).toMatch(
      /load_risk_subject_core[\s\S]*from public\.medications[\s\S]*medication\.subject_id = subject\.id/iu,
    );
    expect(sql).toMatch(
      /load_risk_subject_core[\s\S]*from public\.shelter_checkins[\s\S]*attestation_state = 'VERIFIED'[\s\S]*interval '24 hours'[\s\S]*checked_in_at <= p_computed_at/iu,
    );
    expect(sql).toMatch(
      /load_risk_history[\s\S]*from public\.risk_snapshots[\s\S]*from public\.risk_episodes[\s\S]*from public\.alert_transitions/iu,
    );
  });

  it("commits snapshot, episode, and transition without claiming provider delivery", () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /commit_risk_computation[\s\S]*insert into public\.risk_snapshots[\s\S]*on conflict \(subject_id, bucket_start, input_hash\) do nothing/iu,
    );
    expect(sql).toMatch(
      /commit_risk_computation[\s\S]*insert into public\.risk_episodes[\s\S]*insert into public\.alert_transitions/iu,
    );
    const functionBody = sql.match(
      /create or replace function public\.commit_risk_computation[\s\S]*?\$\$;/iu,
    )?.[0];
    expect(functionBody).not.toMatch(/insert into public\.care_events/iu);
    expect(sql).toMatch(/on conflict \(idempotency_key\) do nothing/iu);
  });
});
