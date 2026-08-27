import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/routes/verify.$uid.tsx"), "utf8");

describe("S-07 public verification route contract", () => {
  it("is a public loader backed by the server-only verification boundary", () => {
    expect(source).toContain('createFileRoute("/verify/$uid")');
    expect(source).toMatch(/createServerFn\(\{\s*method:\s*"GET"\s*\}\)/u);
    expect(source).toContain("verifyEasAttestation");
    expect(source).toContain("createBaseSepoliaEasLookupPort");
    expect(source).toContain("VerificationView");
    expect(source).toMatch(/\^0x\[0-9a-f\]\{64\}\$/u);
    expect(source).toContain('return { status: "NOT_FOUND" }');
    expect(source).not.toMatch(/requireUser|redirect\(.*login|service_role|PRIVATE_KEY/u);
  });

  it("keeps RPC and expected issuer/schema configuration inside the server handler", () => {
    expect(source).toContain("getServerEnv");
    expect(source).toContain("BASE_SEPOLIA_RPC_URL");
    expect(source).toContain("EAS_CARE_SCHEMA_UID");
    expect(source).toContain("EAS_SHELTER_SCHEMA_UID");
    expect(source).toContain("EAS_EXPECTED_ISSUER");
    expect(source).not.toMatch(/import\.meta\.env|VITE_|process\.env/u);
  });
});
