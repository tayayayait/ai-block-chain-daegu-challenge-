import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function registrationMigration(): string {
  const directory = resolve(process.cwd(), "supabase/migrations");
  const file = readdirSync(directory).find((name) => name.endsWith("_register_real_subject.sql"));
  if (!file) throw new Error("subject registration migration is missing");
  return readFileSync(resolve(directory, file), "utf8");
}

describe("atomic real subject registration migration", () => {
  it("allows only service_role and atomically inserts the subject plus creator assignment", () => {
    const source = registrationMigration();

    expect(source).toMatch(
      /create\s+or\s+replace\s+function\s+public\.register_subject_service_role/iu,
    );
    expect(source).toMatch(/security\s+invoker/iu);
    expect(source).toMatch(/set\s+search_path\s*=\s*''/iu);
    expect(source).toMatch(/insert\s+into\s+public\.subjects/iu);
    expect(source).toMatch(/insert\s+into\s+public\.subject_assignments/iu);
    expect(source).toMatch(/role\s*=\s*'ADMIN'/iu);
    expect(source).toMatch(/st_makepoint/iu);
    expect(source).toMatch(/revoke\s+all[^;]+from\s+public\s*,\s*anon\s*,\s*authenticated/isu);
    expect(source).toMatch(/grant\s+execute[^;]+to\s+service_role/isu);
    expect(source).not.toMatch(/grant\s+execute[^;]+to\s+(?:anon|authenticated)/isu);
  });
});
