import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(resolve(process.cwd(), "src/routes/index.tsx"), "utf8");
const shellSource = readFileSync(
  resolve(process.cwd(), "src/components/onjung/Shells.tsx"),
  "utf8",
);

describe("public home real-data contract", () => {
  it("loads a cache-bounded server summary and never imports fixture data", () => {
    expect(routeSource).toContain('createServerFn({ method: "GET" })');
    expect(routeSource).toContain("loadProductionLiveHomeSummary");
    expect(routeSource).toContain(
      'setResponseHeader("cache-control", "public, max-age=300, stale-while-revalidate=900")',
    );
    expect(routeSource).not.toContain("@/lib/mock");
    expect(routeSource).not.toMatch(/rankedSubjects|weatherNow|시연용 목데이터/u);
  });

  it("does not publish fabricated risk totals or a fabricated attestation UID", () => {
    expect(routeSource).not.toMatch(/위험 L4|경고 L3|관할 대상자|관할 평균 위험도/u);
    expect(routeSource).not.toMatch(/\/verify\/0x[0-9a-f]{64}/iu);
    expect(shellSource).not.toMatch(/\/verify\/0x[0-9a-f]{64}/iu);
  });

  it("renders explicit upstream availability states instead of numeric defaults", () => {
    expect(routeSource).toContain("기상 관측을 일시적으로 불러오지 못했습니다");
    expect(routeSource).toContain("쉼터 수 집계 지연");
    expect(routeSource).toContain("기상청 API허브 500m 관측");
    expect(routeSource).toContain("기상청 단기예보 보완값");
  });
});
