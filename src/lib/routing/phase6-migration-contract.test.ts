import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = join(process.cwd(), "supabase", "migrations");

function phase6Migration(): string {
  const file = readdirSync(migrationDirectory).find((name) =>
    name.includes("phase6_spatial_routing"),
  );
  if (!file) return "";
  return readFileSync(join(migrationDirectory, file), "utf8");
}

function vworldImportMigration(): string {
  const file = readdirSync(migrationDirectory).find((name) =>
    name.includes("vworld_building_import"),
  );
  if (!file) return "";
  return readFileSync(join(migrationDirectory, file), "utf8");
}

describe("Phase 6 spatial migration contract", () => {
  it("creates provenance-rich spatial tables with quality constraints and GIST indexes", () => {
    const sql = phase6Migration();
    for (const table of [
      "building_footprints",
      "rest_spots",
      "barrier_segments",
      "spatial_data_releases",
      "route_cache",
    ]) {
      expect(sql).toMatch(new RegExp(`create table public\\.${table}`, "iu"));
    }
    expect(sql).toMatch(/geometry\((?:Multi)?Polygon,\s*4326\)/iu);
    expect(sql).toMatch(
      /height_m[\s\S]*height_source[\s\S]*height_is_estimated[\s\S]*height_estimation_version/iu,
    );
    expect(sql.match(/using gist/giu)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/st_isvalid/iu);
    expect(sql).toMatch(
      /source_crs[\s\S]*target_crs[\s\S]*coverage[\s\S]*confidence[\s\S]*unknown_reason/iu,
    );
    expect(sql).toMatch(/validate_phase6_spatial_data/iu);
  });

  it("keeps spatial data server-only and exposes a service-role-only context RPC", () => {
    const sql = phase6Migration();
    expect(sql).toMatch(/force row level security/iu);
    expect(sql).toMatch(/revoke all[\s\S]*from public, anon, authenticated/iu);
    expect(sql).toMatch(/route_spatial_context/iu);
    expect(sql).toMatch(/grant execute[\s\S]*route_spatial_context[\s\S]*to service_role/iu);
  });

  it("adds an idempotent pending check-in transaction callable only by service role", () => {
    const sql = phase6Migration();
    expect(sql).toMatch(/client_request_id uuid[\s\S]*unique/iu);
    expect(sql).toMatch(/attestation_verified_at timestamptz/iu);
    expect(sql).toMatch(/create_pending_shelter_checkin/iu);
    expect(sql).toMatch(/'PENDING'/iu);
    expect(sql).toMatch(/insert into public\.attestation_jobs/iu);
    expect(sql).toMatch(
      /grant execute[\s\S]*create_pending_shelter_checkin[\s\S]*to service_role/iu,
    );
    expect(sql).toMatch(
      /attestation_state = 'VERIFIED'[\s\S]*attestation_verified_at is not null/iu,
    );
  });

  it("stages VWorld buildings in resumable batches and activates only a complete release", () => {
    const sql = vworldImportMigration();
    expect(sql).toMatch(/expected_feature_count/iu);
    expect(sql).toMatch(/begin_vworld_building_import/iu);
    expect(sql).toMatch(/append_vworld_building_import/iu);
    expect(sql).toMatch(/jsonb_array_length\(p_features\)[\s\S]*(?:500|1\s+and\s+500)/iu);
    expect(sql).toMatch(/on conflict\s*\(release_id,\s*source_feature_id\)\s*do nothing/iu);
    expect(sql).toMatch(/finalize_vworld_building_import/iu);
    expect(sql).toMatch(/v_loaded_count[\s\S]*v_expected_count/iu);
    expect(sql).toMatch(/set active = false[\s\S]*set active = true/iu);
    expect(sql.match(/grant execute on function public\./giu)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toMatch(/revoke all[\s\S]*from public, anon, authenticated/iu);
  });

  it("queries time-aware building reach with a geography index while keeping data server-only", () => {
    const sql = vworldImportMigration();
    expect(sql).toMatch(/building_footprints_geog_gist/iu);
    expect(sql).toMatch(/route_spatial_context_at_time/iu);
    expect(sql).toMatch(/p_shadow_factor/iu);
    expect(sql).toMatch(/height_m(?:::[a-z ]+)?\s*\*\s*p_shadow_factor/iu);
    expect(sql).toMatch(/p_max_shadow_m/iu);
    expect(sql).toMatch(
      /grant execute[\s\S]*route_spatial_context_at_time[\s\S]*to service_role/iu,
    );
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete)[\s\S]*to\s+anon/iu);
  });
});
