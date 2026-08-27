import { describe, expect, it } from "vitest";

import badgesSource from "@/components/onjung/Badges.tsx?raw";
import ribbonSource from "@/components/onjung/Ribbon.tsx?raw";
import dashboardViewSource from "@/lib/dashboard/DashboardView.tsx?raw";
import mockDataSource from "./mock/data.ts?raw";
import hriSource from "./risk/hri.ts?raw";
import presentationSource from "./risk/presentation.ts?raw";

interface DomainTypesModule {
  RISK_LEVELS: readonly string[];
  MED_RISK_TIERS: readonly string[];
  MED_SOURCES: readonly string[];
  ATTEST_STATES: readonly string[];
  SHELTER_OPEN_STATES: readonly string[];
  CROWD_LEVELS: readonly string[];
  HEAT_ADVISORIES: readonly string[];
  ASYNC_STATES: readonly string[];
}

interface HeatClassesModule {
  HEAT_CLASS_TIER: Readonly<Record<string, string>>;
}

const domainTypeModules = import.meta.glob("./domain-types.ts", { eager: true });
const medicationModules = import.meta.glob("./medication/heat-classes.ts", { eager: true });

describe("domain type leaf", () => {
  it("상세서 11.1의 8개 상태 집합을 단일 readonly tuple 계약으로 제공한다", () => {
    const domainTypes = domainTypeModules["./domain-types.ts"] as DomainTypesModule | undefined;

    expect(domainTypes).toBeDefined();
    if (!domainTypes) return;

    expect(domainTypes.RISK_LEVELS).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(domainTypes.MED_RISK_TIERS).toEqual(["HIGH", "MID", "NONE"]);
    expect(domainTypes.MED_SOURCES).toEqual(["AI_AUTO", "AI_CONFIRMED", "MANUAL"]);
    expect(domainTypes.ATTEST_STATES).toEqual(["UNVERIFIED", "PENDING", "VERIFIED", "FAILED"]);
    expect(domainTypes.SHELTER_OPEN_STATES).toEqual(["OPEN", "CLOSED", "UNKNOWN"]);
    expect(domainTypes.CROWD_LEVELS).toEqual(["SPARSE", "MODERATE", "CROWDED"]);
    expect(domainTypes.HEAT_ADVISORIES).toEqual(["NONE", "WATCH", "WARNING"]);
    expect(domainTypes.ASYNC_STATES).toEqual([
      "idle",
      "loading",
      "refreshing",
      "success",
      "empty",
      "error",
      "partial",
    ]);
  });

  it("HRI가 중앙 HeatAdvisory 값 집합을 파싱하고 타입을 재정의·재수출하지 않는다", () => {
    expect(hriSource).toContain('from "@/lib/domain-types"');
    expect(hriSource).toContain("heatAdvisory: z.enum(HEAT_ADVISORIES)");
    expect(hriSource).not.toMatch(
      /export type (?:RiskLevel|MedRiskTier|MedSource|AttestState|ShelterOpen|CrowdLevel|HeatAdvisory)\b/,
    );
    expect(hriSource).not.toMatch(/export (?:type )?\{[^}]*RiskLevel[^}]*\}/s);
  });

  it("표현·UI·mock 소비자가 HRI가 아닌 중앙 타입 leaf를 참조한다", () => {
    for (const source of [presentationSource, badgesSource, ribbonSource, dashboardViewSource]) {
      expect(source).toContain('from "@/lib/domain-types"');
    }
    expect(mockDataSource).toContain('from "@/lib/domain-types"');
    expect(mockDataSource).toMatch(/riskLevel:\s*RiskLevel;/);
  });
});

describe("medication heat class leaf", () => {
  it("약물 열위험 분류표를 HRI 계산 모듈 밖에서 제공한다", () => {
    const medication = medicationModules["./medication/heat-classes.ts"] as
      HeatClassesModule | undefined;

    expect(medication).toBeDefined();
    if (!medication) return;

    expect(medication.HEAT_CLASS_TIER).toMatchObject({
      이뇨제: "HIGH",
      항콜린제: "HIGH",
      혈압강하제: "MID",
      교감신경흥분제: "MID",
    });
    expect(hriSource).not.toContain("HEAT_CLASS_TIER");
    expect(mockDataSource).toContain('from "@/lib/medication/heat-classes"');
  });
});
