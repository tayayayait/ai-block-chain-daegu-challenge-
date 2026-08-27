import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/routes/subjects.$id.tsx"), "utf8");

describe("S-02 subject route contract", () => {
  it("uses validated server functions and a loader instead of operational mock data", () => {
    expect(source).toContain('createFileRoute("/subjects/$id")');
    expect(source).toMatch(/createServerFn\(\{\s*method:\s*"GET"\s*\}\)/);
    expect(source).toMatch(/createServerFn\(\{\s*method:\s*"POST"\s*\}\)/);
    expect(source).toContain("loader:");
    expect(source).not.toMatch(/@\/lib\/mock|mock\/data/);
  });

  it("loads masked detail separately from the explicit PII reveal request", () => {
    expect(source).toContain("loadSubjectDetailForRequest");
    expect(source).toContain("revealSubjectPiiForRequest");
    expect(source).toContain('purpose: "CARE_COORDINATION"');
  });

  it("connects completed medication, subject-scoped shelter, and EAS verification features", () => {
    expect(source).toContain("medicationCapture");
    expect(source).toContain("shelterRouting");
    expect(source).toContain("attestationVerification");
    expect(source).toContain("/shelters?subjectId=");
    expect(source).toContain('href: "/verify"');
  });
});
