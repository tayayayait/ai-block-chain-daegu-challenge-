import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260824160000_preserve_weather_reuse_snapshots.sql",
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("weather snapshot reuse migration", () => {
  it("keeps each collection attempt append-only without changing table access", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/drop constraint weather_snapshots_location_key_source_observed_at_key/iu);
    expect(sql).not.toMatch(/drop constraint if exists/iu);
    expect(sql).toMatch(/unique \(location_key, source, observed_at, collected_at\)/iu);
    expect(sql).not.toMatch(/grant .*weather_snapshots.*(?:anon|authenticated)/iu);
    expect(sql).not.toMatch(/disable row level security/iu);
  });
});
