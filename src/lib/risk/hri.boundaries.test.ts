import { describe, expect, it } from "vitest";

import type { HeatAdvisory } from "@/lib/domain-types";
import { computeHri, levelOf, type HriInput } from "./hri";
import { buildHriReasons } from "./reasons";

const neutralInput = {
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
} satisfies HriInput;

const compute = (override: Partial<HriInput> = {}) => computeHri({ ...neutralInput, ...override });

describe("HRI environment boundaries", () => {
  it.each([
    [30.9, 0, "L0"],
    [31, 10, "L0"],
    [33, 20, "L1"],
    [35, 32, "L1"],
    [38, 42, "L2"],
    [40, 50, "L2"],
  ] as const)(
    "체감온도 %s℃의 환경 기본점수와 HRI는 %s점·%s이다",
    (feelsLikeC, expected, expectedLevel) => {
      const result = compute({ feelsLikeC });

      expect(result.breakdown.E).toBe(expected);
      expect(result.score).toBe(expected);
      expect(result.level).toBe(expectedLevel);
      expect(result.contributions.environment.base).toEqual({ raw: expected, applied: expected });
    },
  );

  it.each([
    ["주의보", "WATCH", 0, 3, 3, 0],
    ["경보", "WARNING", 0, 5, 5, 0],
    ["열대야 2일", "NONE", 2, 0, 0, 0],
    ["열대야 3일", "NONE", 3, 5, 0, 5],
  ] satisfies ReadonlyArray<readonly [string, HeatAdvisory, number, number, number, number]>)(
    "%s 환경 가산점은 %i점이다",
    (
      _label,
      heatAdvisory,
      tropicalNightStreak,
      expectedE,
      expectedAdvisory,
      expectedTropicalNight,
    ) => {
      const result = compute({ heatAdvisory, tropicalNightStreak });

      expect(result.breakdown.E).toBe(expectedE);
      expect(result.contributions.environment.advisory.applied).toBe(expectedAdvisory);
      expect(result.contributions.environment.tropicalNight.applied).toBe(expectedTropicalNight);
    },
  );

  it.each([
    [38, "WARNING", 3, 42, 5, 5, 42, 5, 3],
    [40, "WATCH", 3, 50, 3, 5, 50, 0, 0],
  ] satisfies ReadonlyArray<
    readonly [number, HeatAdvisory, number, number, number, number, number, number, number]
  >)(
    "체감 %s℃·%s·열대야 %s일은 원점수 %s+%s+%s를 실제 %s+%s+%s로 배분한다",
    (
      feelsLikeC,
      heatAdvisory,
      tropicalNightStreak,
      baseRaw,
      advisoryRaw,
      tropicalRaw,
      baseApplied,
      advisoryApplied,
      tropicalApplied,
    ) => {
      const result = compute({ feelsLikeC, heatAdvisory, tropicalNightStreak });

      expect(result.breakdown.E).toBe(50);
      expect(result.contributions.environment).toEqual({
        base: { raw: baseRaw, applied: baseApplied },
        advisory: { raw: advisoryRaw, applied: advisoryApplied },
        tropicalNight: { raw: tropicalRaw, applied: tropicalApplied },
      });
    },
  );
});

describe("HRI medication boundaries", () => {
  it.each([
    [0, 0, true, 0, 0, 0, false],
    [1, 0, true, 6, 6, 0, false],
    [0, 1, true, 3, 0, 3, false],
    [1, 1, true, 9, 6, 3, false],
    [4, 1, true, 25, 24, 1, false],
    [5, 8, true, 25, 25, 0, false],
    [5, 8, false, 0, 0, 0, true],
  ] as const)(
    "고위험 %s·중위험 %s·등록 %s이면 M=%s (고위험 %s, 중위험 %s)이다",
    (medHigh, medMid, medRegistered, expectedM, expectedHigh, expectedMid, missingRegistration) => {
      const input = { ...neutralInput, medHigh, medMid, medRegistered };
      const result = computeHri(input);

      expect(result.breakdown.M).toBe(expectedM);
      expect(result.contributions.medication.high.applied).toBe(expectedHigh);
      expect(result.contributions.medication.mid.applied).toBe(expectedMid);
      expect(result.contributions.medication.missingRegistration).toBe(missingRegistration);

      if (missingRegistration) {
        expect(buildHriReasons(input, result)).toContain(
          "복약 정보 미등록 — 위험도가 과소평가될 수 있습니다",
        );
      }
    },
  );
});

describe("HRI personal and mitigation boundaries", () => {
  it.each([
    [64, 0],
    [65, 3],
    [74, 3],
    [75, 5],
    [84, 5],
    [85, 8],
  ] as const)("%s세의 개인 연령점수는 %s점이다", (age, expected) => {
    const result = compute({ age });

    expect(result.breakdown.P).toBe(expected);
    expect(result.contributions.personal.age).toEqual({ raw: expected, applied: expected });
  });

  it.each([
    [85, true, true, true, 20],
    [130, true, true, true, 20],
  ] as const)(
    "%s세·독거 %s·만성질환 %s·냉방 없음 %s의 P는 상한 %s점이다",
    (age, livesAlone, chronicDisease, noCooling, expectedP) => {
      const result = compute({ age, livesAlone, chronicDisease, noCooling });

      expect(result.breakdown.P).toBe(expectedP);
      expect(result.score).toBe(expectedP);
      expect(
        Object.values(result.contributions.personal).reduce(
          (sum, contribution) => sum + contribution.applied,
          0,
        ),
      ).toBe(expectedP);
    },
  );

  it.each([
    [false, 0, 10],
    [true, 6, 4],
  ] as const)(
    "31℃에서 검증된 24시간 체크인=%s이면 C=%s, HRI=%s이다",
    (verified, expectedC, expectedScore) => {
      const result = compute({ feelsLikeC: 31, shelterCheckInVerified24h: verified });

      expect(result.breakdown.C).toBe(expectedC);
      expect(result.score).toBe(expectedScore);
      expect(result.contributions.mitigation.verifiedShelterCheckIn).toEqual({
        raw: expectedC,
        applied: expectedC,
      });
    },
  );
});

describe("HRI risk level boundaries", () => {
  it.each([
    [19, "L0"],
    [20, "L1"],
    [39, "L1"],
    [40, "L2"],
    [59, "L2"],
    [60, "L3"],
    [79, "L3"],
    [80, "L4"],
  ] as const)("HRI %s점은 %s이다", (score, expectedLevel) => {
    expect(levelOf(score)).toBe(expectedLevel);
  });
});

describe("HRI reason selection", () => {
  it.each([
    [
      "기여도가 네 개 이상인 경우",
      {
        feelsLikeC: 35,
        heatAdvisory: "WATCH",
        medHigh: 2,
        age: 85,
        livesAlone: true,
        chronicDisease: true,
        noCooling: true,
        shelterCheckInVerified24h: true,
      },
      [
        "체감 35.0℃ + 폭염주의보 (+35)",
        "폭염 주의 의약품 고위험 2계열 복용 (+12)",
        "85세 고령 (+8)",
      ],
    ],
    [
      "복약 미등록 경고가 있는 경우",
      {
        feelsLikeC: 33,
        medRegistered: false,
        age: 85,
        livesAlone: true,
        chronicDisease: true,
      },
      ["체감 33.0℃ (+20)", "85세 고령 (+8)", "복약 정보 미등록 — 위험도가 과소평가될 수 있습니다"],
    ],
  ] satisfies ReadonlyArray<readonly [string, Partial<HriInput>, readonly string[]]>)(
    "%s에도 실제 기여도 내림차순으로 이유를 최대 3개만 반환한다",
    (_label, override, expectedReasons) => {
      const input = { ...neutralInput, ...override };
      const reasons = buildHriReasons(input, computeHri(input));

      expect(reasons).toHaveLength(3);
      expect(reasons).toEqual(expectedReasons);
    },
  );
});
