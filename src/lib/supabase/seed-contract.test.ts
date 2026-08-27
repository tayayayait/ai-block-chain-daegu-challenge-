import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSeedSql,
  DEMO_SUBJECT_FIXTURES,
  quoteSqlText,
  runSeedGenerator,
} from "../../../scripts/generate-supabase-seed.ts";
import type { ShelterFeatureCollection } from "../../../scripts/prepare-shelters.ts";

const projectRoot = process.cwd();
const shelterCollection = JSON.parse(
  readFileSync(resolve(projectRoot, "data/daegu_shelters.geojson"), "utf8"),
) as ShelterFeatureCollection;
const generatedSql = buildSeedSql(shelterCollection);
const checkedInSql = readFileSync(resolve(projectRoot, "supabase/fixtures/local-demo.sql"), "utf8");

describe("Phase 2 deterministic local Supabase Demo fixture", () => {
  it("matches the checked-in local fixture byte for byte", () => {
    expect(generatedSql).toBe(checkedInSql);
    expect(buildSeedSql(shelterCollection)).toBe(generatedSql);
  });

  it("upserts all 950 audited shelters without changing source aggregates", () => {
    const shelters = shelterCollection.features;
    const facilityCounts = new Map<string, number>();
    for (const { properties } of shelters) {
      facilityCounts.set(
        properties.facility_type,
        (facilityCounts.get(properties.facility_type) ?? 0) + 1,
      );
    }

    expect(shelters).toHaveLength(950);
    expect(facilityCounts.get("경로당")).toBe(466);
    expect(facilityCounts.get("금융기관")).toBe(245);
    expect(facilityCounts.get("행정복지센터")).toBe(129);
    expect(facilityCounts.get("기타")).toBe(110);
    expect(shelters.filter(({ properties }) => properties.is_im_bank)).toHaveLength(100);
    expect(new Set(shelters.map(({ properties }) => properties.gu))).toHaveLength(8);

    expect(generatedSql).toMatch(/insert into public\.shelters/i);
    expect(generatedSql).toMatch(/on conflict \(id\) do update/i);
    const shelterSection = generatedSql.split("-- BEGIN SHELTERS")[1]?.split("-- END SHELTERS")[0];
    expect(shelterSection?.match(/^ {2}\('DG-/gmu)).toHaveLength(950);
    for (const shelter of shelters) {
      expect(generatedSql).toContain(quoteSqlText(shelter.id));
    }
    expect(generatedSql).not.toMatch(/\b(?:delete|truncate)\s+(?:from\s+)?public\.shelters/iu);
  });

  it("supports a non-mutating --check equivalent", async () => {
    await expect(runSeedGenerator("check")).resolves.toBeUndefined();
  });

  it("contains five explicitly fictional, assigned L0-L4 subjects", () => {
    expect(DEMO_SUBJECT_FIXTURES).toHaveLength(5);
    expect(DEMO_SUBJECT_FIXTURES.map(({ expectedLevel }) => expectedLevel)).toEqual([
      "L0",
      "L1",
      "L2",
      "L3",
      "L4",
    ]);
    expect(DEMO_SUBJECT_FIXTURES.every(({ name }) => name.includes("가상"))).toBe(true);
    expect(generatedSql).toMatch(/insert into auth\.users/i);
    expect(generatedSql).toMatch(/insert into public\.profiles/i);
    expect(generatedSql).toMatch(/insert into public\.subject_assignments/i);
    expect([...generatedSql.matchAll(/, null, null, '가상 주소 ·/gu)]).toHaveLength(5);
  });

  it("keeps medication registration and attestation scenarios explicit", () => {
    expect(DEMO_SUBJECT_FIXTURES.some(({ medRegistered }) => medRegistered)).toBe(true);
    expect(DEMO_SUBJECT_FIXTURES.some(({ medRegistered }) => !medRegistered)).toBe(true);
    expect(DEMO_SUBJECT_FIXTURES.some(({ checkinState }) => checkinState === "VERIFIED")).toBe(
      true,
    );
    expect(DEMO_SUBJECT_FIXTURES.some(({ checkinState }) => checkinState === "UNVERIFIED")).toBe(
      true,
    );
    expect(generatedSql).toMatch(/insert into public\.medications/i);
    expect(generatedSql).toMatch(/insert into public\.shelter_checkins/i);
  });

  it("keeps seeded weather rows idempotent with the append-only collection key", () => {
    expect(generatedSql).toMatch(
      /on conflict \(location_key, source, observed_at, collected_at\) do update/iu,
    );
    expect(generatedSql).not.toMatch(
      /on conflict \(location_key, source, observed_at\) do update/iu,
    );
    expect(generatedSql).toMatch(
      /where location_key = [\s\S]+?and source = 'KMA_APIHUB_500M'[\s\S]+?and observed_at = [\s\S]+?and collected_at = /iu,
    );
  });

  it("seeds only clearly labelled partial spatial fixtures for deterministic route demos", () => {
    expect(generatedSql).toMatch(/insert into public\.spatial_data_releases/iu);
    expect(generatedSql).toMatch(/DEMO_FIXTURE_NOT_REAL_DATA/iu);
    expect(generatedSql).toMatch(/COMMUNITY_PARTIAL/iu);
    expect(generatedSql).toMatch(/insert into public\.building_footprints/iu);
    expect(generatedSql).toMatch(/insert into public\.rest_spots/iu);
    expect(generatedSql).toMatch(/insert into public\.barrier_segments/iu);
  });

  it("seeds consented Demo notification preferences using opaque recipient references", () => {
    const preferenceSection = generatedSql
      .split("-- Demo-only opaque recipient references")[1]
      ?.split("-- s-001 is reviewed")[0];
    expect(generatedSql).toMatch(/insert into public\.guardian_notification_preferences/iu);
    expect(generatedSql).toMatch(/demo-recipient:/iu);
    expect(preferenceSection).toBeDefined();
    expect(preferenceSection).not.toMatch(/010[- ]?\d{3,4}[- ]?\d{4}/u);
  });

  it("keeps local-only consent evidence explicit so notification fixtures remain eligible", () => {
    const preferenceSection = generatedSql
      .split("-- Demo-only opaque recipient references")[1]
      ?.split("-- s-001 is reviewed")[0];

    expect(preferenceSection).toMatch(/revision/iu);
    expect(preferenceSection).toMatch(/consent_text_version/iu);
    expect(preferenceSection).toMatch(/consent_source/iu);
    expect(preferenceSection).toMatch(/consent_evidence_id/iu);
    expect(preferenceSection).toMatch(/LOCAL_FIXTURE/iu);
  });

  it("stores a breakdown whose subtraction agrees with every HRI and level", () => {
    for (const fixture of DEMO_SUBJECT_FIXTURES) {
      const { E, M, P, C } = fixture.risk.breakdown;
      expect(fixture.risk.score).toBe(Math.max(0, Math.min(100, E + M + P - C)));
      expect(fixture.risk.level).toBe(fixture.expectedLevel);
      expect(generatedSql).toContain(
        `-- ${fixture.stableId}: ${fixture.risk.level} = ${fixture.risk.score} (${E} + ${M} + ${P} - ${C})`,
      );
      expect(generatedSql).toContain(
        `${quoteSqlText(JSON.stringify(fixture.risk.breakdown))}::jsonb`,
      );
    }
  });

  it("quotes SQL text and rejects PostgreSQL NUL injection", () => {
    expect(quoteSqlText("쉼터 O'Reilly \\ demo")).toBe("'쉼터 O''Reilly \\ demo'");
    expect(() => quoteSqlText("invalid\0value")).toThrow(/NUL/u);
  });

  it("contains only reserved demo identities and no real service credential", () => {
    expect(generatedSql).toContain("@onjung.invalid");
    expect(generatedSql).not.toMatch(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/u);
    expect(generatedSql).not.toMatch(
      /(?:service_role|anonpublic|authKey|appKey|client[_ ]secret)/iu,
    );
  });
});
