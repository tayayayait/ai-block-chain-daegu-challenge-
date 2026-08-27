import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/routes/alert.$eventId.tsx"), "utf8");
const homeSource = readFileSync(resolve(process.cwd(), "src/routes/index.tsx"), "utf8");

describe("S-08 guardian alert route contract", () => {
  it("exchanges a token with POST then replace-redirects to the token-free URL", () => {
    expect(source).toContain('createFileRoute("/alert/$eventId")');
    expect(source).toMatch(
      /createServerFn\(\{ method: "POST" \}\)[\s\S]*exchangeGuardianAlertTokenForRequest/u,
    );
    expect(source).toMatch(/throw redirect\([\s\S]*replace:\s*true/u);
    expect(source).toContain("validateSearch:");
  });

  it("loads refreshes through the server session and renders one generic failure state", () => {
    expect(source).toMatch(
      /createServerFn\(\{ method: "GET" \}\)[\s\S]*loadGuardianAlertForRequest/u,
    );
    expect(source).toContain("만료되었거나 이미 다른 기기에서 사용된 링크입니다");
    expect(source).toContain("담당 돌봄기관에 문의");
  });

  it("does not place provider secrets or forbidden PII fields in the route module", () => {
    expect(source).not.toMatch(
      /SUPABASE_SECRET|service_role|guardian_phone|subject_id|road_address/iu,
    );
  });

  it("does not publish a fake alert URL on the public home page", () => {
    expect(homeSource).not.toMatch(/to:\s*"\/alert\//u);
    expect(homeSource).not.toMatch(/\/alert\/0x[0-9a-f]+/iu);
  });
});
