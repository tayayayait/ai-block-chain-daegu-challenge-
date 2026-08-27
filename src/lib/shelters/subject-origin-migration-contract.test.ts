import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260824101000_phase6_subject_shelter_origin.sql"),
  "utf8",
);

describe("subject-scoped shelter origin SQL boundary", () => {
  it("returns numeric coordinates without granting the RPC to browser roles", () => {
    expect(migration).toMatch(/get_subject_shelter_origin\s*\(/iu);
    expect(migration).toMatch(/st_y\(s\.location::extensions\.geometry\)/iu);
    expect(migration).toMatch(/st_x\(s\.location::extensions\.geometry\)/iu);
    expect(migration).toMatch(/revoke execute[\s\S]*from public, anon, authenticated/iu);
    expect(migration).toMatch(/grant execute[\s\S]*to service_role/iu);
  });
});
