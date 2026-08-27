import { describe, expect, it } from "vitest";

import { computeHri, type HriInput } from "./hri";
import { buildHriReasons } from "./reasons";

const baseInput: HriInput = {
  feelsLikeC: 30,
  heatAdvisory: "NONE",
  tropicalNightStreak: 0,
  medHigh: 0,
  medMid: 0,
  medRegistered: true,
  age: 40,
  livesAlone: false,
  chronicDisease: false,
  noCooling: false,
  shelterCheckInVerified24h: false,
};

const reasonsFor = (override: Partial<HriInput>) => {
  const input = { ...baseInput, ...override };
  return buildHriReasons(input, computeHri(input));
};

describe("buildHriReasons", () => {
  it("체감과 실제 반영된 특보를 합치고 열대야 실제 반영분은 별도 표시한다", () => {
    expect(
      reasonsFor({
        feelsLikeC: 39.2,
        heatAdvisory: "WARNING",
        tropicalNightStreak: 4,
      }),
    ).toEqual(["체감 39.2℃ + 폭염경보 (+47)", "열대야 4일 연속 (+3)"]);
  });

  it("E 상한 때문에 0점 반영된 특보와 열대야를 이유에 중복 표시하지 않는다", () => {
    expect(
      reasonsFor({
        feelsLikeC: 40,
        heatAdvisory: "WARNING",
        tropicalNightStreak: 4,
      }),
    ).toEqual(["체감 40.0℃ (+50)"]);
  });

  it("실제 기여도 내림차순으로 최대 세 개만 반환한다", () => {
    expect(
      reasonsFor({
        feelsLikeC: 35,
        heatAdvisory: "WATCH",
        tropicalNightStreak: 3,
        medHigh: 2,
        age: 85,
        livesAlone: true,
        chronicDisease: true,
        noCooling: true,
        shelterCheckInVerified24h: true,
      }),
    ).toEqual([
      "체감 35.0℃ + 폭염주의보 (+35)",
      "폭염 주의 의약품 고위험 2계열 복용 (+12)",
      "85세 고령 (+8)",
    ]);
  });

  it("복약 미등록은 0점 경고 이유로 표시한다", () => {
    expect(reasonsFor({ medRegistered: false })).toEqual([
      "복약 정보 미등록 — 위험도가 과소평가될 수 있습니다",
    ]);
  });

  it("양수 이유가 세 개 이상이어도 복약 미등록 경고를 마지막 이유로 보존한다", () => {
    expect(
      reasonsFor({
        feelsLikeC: 35,
        heatAdvisory: "WATCH",
        tropicalNightStreak: 3,
        medRegistered: false,
        age: 85,
        livesAlone: true,
        chronicDisease: true,
        noCooling: true,
        shelterCheckInVerified24h: true,
      }),
    ).toEqual([
      "체감 35.0℃ + 폭염주의보 (+35)",
      "85세 고령 (+8)",
      "복약 정보 미등록 — 위험도가 과소평가될 수 있습니다",
    ]);
  });
});
