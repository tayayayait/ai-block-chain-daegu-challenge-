import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const script = readFileSync(resolve(process.cwd(), "scripts/register-eas-schemas.ts"), "utf8");

describe("one-time EAS schema registration CLI", () => {
  it("uses the validated registration service and emits only its safe formatter", () => {
    expect(script).toContain("parseSchemaRegistrationConfig");
    expect(script).toContain("createSchemaRegistrationService");
    expect(script).toContain("formatSchemaRegistrationResult");
    expect(script).not.toMatch(/console\.(?:log|error)\([^)]*(?:process\.env|privateKey|rpcUrl)/iu);
  });
});
