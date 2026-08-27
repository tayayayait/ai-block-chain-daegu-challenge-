import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Phase 5 public route contract", () => {
  it("connects /shelters to server-side search and NAVER address lookup", () => {
    const source = readFileSync(resolve(root, "src/routes/shelters.tsx"), "utf8");
    const explorerSource = readFileSync(
      resolve(root, "src/components/shelters/ShelterExplorer.tsx"),
      "utf8",
    );
    const locationSearcherSource = readFileSync(
      resolve(root, "src/integrations/location-search/location-search.server.ts"),
      "utf8",
    );

    expect(source).toContain('createFileRoute("/shelters")');
    expect(source.match(/createServerFn\(\{ method: "GET" \}\)/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(source).toContain("searchShelters");
    expect(source).toContain("createSmartLocationSearcherFromEnv");
    expect(locationSearcherSource).toContain("createNaverGeocoder");
    expect(source).toContain("<ShelterExplorer");
    expect(source).toContain("inferPublicShelterOriginSource");
    expect(source).toContain('from("shelters").select("id"');
    expect(source).toContain('count: "exact"');
    expect(source).toContain("totalShelterCount");
    expect(explorerSource).not.toContain("대구 무더위쉼터 950곳");
    expect(source).toContain("wide");
    expect(source).not.toContain("NAVER_MAPS_CLIENT_SECRET=");
  });

  it("connects /report/$shelterId to the anonymous, server-only report transaction", () => {
    const source = readFileSync(resolve(root, "src/routes/report.$shelterId.tsx"), "utf8");
    const handlerSource = readFileSync(resolve(root, "src/routes/-report-post.server.ts"), "utf8");

    expect(source).toContain('createFileRoute("/report/$shelterId")');
    expect(source).toContain("handleShelterReportPostRequest");
    expect(source).toContain("Base Sepolia 테스트넷");
    expect(handlerSource).toContain('import "@tanstack/react-start/server-only"');
    expect(handlerSource).toContain("submitAnonymousShelterReport");
    expect(handlerSource).toContain("REPORTER_HASH_SECRET");
    expect(`${source}\n${handlerSource}`).not.toMatch(/reporterHash\s*:/);
  });
});
