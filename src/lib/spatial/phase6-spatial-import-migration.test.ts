import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase", "migrations");

function migrationSource(): string {
  const migration = readdirSync(migrationsDirectory).find((name) =>
    name.endsWith("_phase6_spatial_import.sql"),
  );
  expect(migration, "phase6_spatial_import migration").toBeDefined();
  return readFileSync(resolve(migrationsDirectory, migration ?? "missing"), "utf8");
}

describe("Phase 6 spatial import database contract", () => {
  it("persists attribution, coverage, audit, observation, and slope provenance", () => {
    const sql = migrationSource();

    expect(sql).toMatch(/spatial_data_releases[\s\S]*attribution\s+text/iu);
    expect(sql).toMatch(/spatial_data_releases[\s\S]*coverage_geom\s+extensions\.geometry/iu);
    expect(sql).toMatch(/spatial_data_releases[\s\S]*quality_audit\s+jsonb/iu);
    expect(sql.match(/add column observed_at timestamptz/giu)?.length).toBe(3);
    expect(sql).toMatch(/barrier_segments[\s\S]*slope_source\s+text/iu);
  });

  it("stages and validates every dataset before atomically activating its release", () => {
    const sql = migrationSource();

    expect(sql).toMatch(/create or replace function public\.import_phase6_spatial_release/iu);
    expect(sql).toMatch(/insert into public\.spatial_data_releases[\s\S]*false/iu);
    expect(sql).toMatch(/st_isvalid/iu);
    expect(sql).toMatch(/st_coveredby/iu);
    expect(sql).toMatch(/count\s*\(\s*distinct[\s\S]*sourceFeatureId/iu);
    expect(sql).toMatch(/restType[\s\S]*BENCH[\s\S]*PAVILION[\s\S]*SHADE_CANOPY/iu);
    expect(sql).toMatch(/barrierType[\s\S]*STEEP_SLOPE/iu);
    expect(sql).toMatch(/slopePercent[\s\S]*(?:>|<=)\s*5/iu);
    expect(sql).toMatch(/update public\.spatial_data_releases[\s\S]*active = false/iu);
    expect(sql).toMatch(/update public\.spatial_data_releases[\s\S]*active = true/iu);
  });

  it("makes the definer RPC service-role-only with a fixed empty search path", () => {
    const sql = migrationSource();

    expect(sql).toMatch(/security definer[\s\S]*set search_path = ''/iu);
    expect(sql).toMatch(
      /revoke all on function public\.import_phase6_spatial_release\(jsonb, jsonb, jsonb\)[\s\S]*from public, anon, authenticated/iu,
    );
    expect(sql).toMatch(
      /grant execute on function public\.import_phase6_spatial_release\(jsonb, jsonb, jsonb\)[\s\S]*to service_role/iu,
    );
    expect(sql).not.toMatch(/service[_-]?role[^\n]*['"][A-Za-z0-9._-]{20,}/iu);
  });
});
