import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migrationSource(name: string) {
  const file = readdirSync(migrationsDirectory).find((candidate) =>
    candidate.endsWith(`_${name}.sql`),
  );
  expect(file, `migration ${name}`).toBeDefined();
  return readFileSync(resolve(migrationsDirectory, file ?? "missing"), "utf8");
}

describe("Supabase migration contract", () => {
  it("enables spatial, cryptographic, and database-test extensions without pinning versions", () => {
    const source = migrationSource("enable_required_extensions");

    for (const extension of ["postgis", "pgcrypto", "pgtap"] as const) {
      expect(source).toMatch(
        new RegExp(`create\\s+extension\\s+if\\s+not\\s+exists\\s+${extension}`, "i"),
      );
    }
    expect(source).not.toMatch(/create\s+extension[\s\S]*?\bversion\b/i);
  });
});
