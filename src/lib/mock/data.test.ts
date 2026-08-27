import { describe, expect, it } from "vitest";

import { getSubject, medCounts, riskOf, type Medication, type Subject } from "./data";

const medication = (
  id: string,
  heatClass: string,
  riskTier: Medication["riskTier"],
): Medication => ({
  id,
  productName: `TEST-${id}`,
  heatClass,
  riskTier,
  source: "MANUAL",
  confidence: null,
});

const syntheticSubject = (medications: Medication[]): Subject => ({
  id: "test-subject",
  name: "테스트 대상자",
  maskedName: "테○○",
  age: 70,
  sex: "여",
  gu: "테스트구",
  address: "",
  guardianName: "",
  guardianPhone: "",
  livesAlone: false,
  chronicDisease: false,
  hasCooling: true,
  medRegistered: true,
  medications,
  checkInVerified24h: false,
  feelsLikeC: 30,
  lat: 0,
  lng: 0,
});

describe("mock risk composition", () => {
  it("순수 HRI 계산 결과에 UI 이유를 합성해 기존 대시보드 계약을 유지한다", () => {
    const subject = getSubject("s-001");

    expect(subject).toBeDefined();
    expect(riskOf(subject!).reasons).toEqual([
      "체감 39.2℃ + 폭염경보 (+47)",
      "폭염 주의 의약품 고위험 2계열 · 중위험 1계열 복용 (+15)",
      "87세 고령 (+8)",
    ]);
  });

  it.each([
    [
      "같은 고위험 계열 두 건",
      [medication("high-a", "이뇨제", "HIGH"), medication("high-b", "이뇨제", "HIGH")],
      { medHigh: 1, medMid: 0 },
    ],
    [
      "같은 중위험 계열 두 건",
      [medication("mid-a", "리튬", "MID"), medication("mid-b", "리튬", "MID")],
      { medHigh: 0, medMid: 1 },
    ],
    [
      "중복 계열과 서로 다른 계열의 혼합",
      [
        medication("high-a", "이뇨제", "HIGH"),
        medication("high-b", "이뇨제", "HIGH"),
        medication("high-c", "항콜린제", "HIGH"),
        medication("mid-a", "리튬", "MID"),
        medication("mid-b", "리튬", "MID"),
      ],
      { medHigh: 2, medMid: 1 },
    ],
  ] as const)(
    "%s은 약물 건수가 아니라 고유 계열 수로 계산한다",
    (_label, medications, expected) => {
      expect(medCounts(syntheticSubject([...medications]))).toEqual(expected);
    },
  );
});
