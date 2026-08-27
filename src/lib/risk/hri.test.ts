import { describe, expect, it } from "vitest";

import { computeHri, HriInputSchema, type HriInput } from "./hri";

const validInput: HriInput = {
  feelsLikeC: 39.2,
  heatAdvisory: "WARNING",
  tropicalNightStreak: 4,
  medHigh: 2,
  medMid: 1,
  medRegistered: true,
  age: 87,
  livesAlone: true,
  chronicDisease: true,
  noCooling: true,
  shelterCheckInVerified24h: false,
};

describe("computeHri structured contributions", () => {
  it("E 상한을 base, advisory, tropicalNight 순서로 배분한다", () => {
    const result = computeHri(validInput) as ReturnType<typeof computeHri> & {
      contributions?: {
        environment: {
          base: { raw: number; applied: number };
          advisory: { raw: number; applied: number };
          tropicalNight: { raw: number; applied: number };
        };
      };
    };

    expect(result.breakdown.E).toBe(50);
    expect(result.contributions?.environment).toEqual({
      base: { raw: 42, applied: 42 },
      advisory: { raw: 5, applied: 5 },
      tropicalNight: { raw: 5, applied: 3 },
    });
  });

  it("계산 결과에는 UI 이유 문자열을 포함하지 않는다", () => {
    expect(computeHri(validInput)).not.toHaveProperty("reasons");
  });

  it("복약·개인·완화 점수의 원점수와 실제 반영분을 구조화한다", () => {
    const result = computeHri(validInput) as ReturnType<typeof computeHri> & {
      contributions: Record<string, unknown>;
    };

    expect(result.contributions).toMatchObject({
      medication: {
        high: { raw: 12, applied: 12 },
        mid: { raw: 3, applied: 3 },
        missingRegistration: false,
      },
      personal: {
        age: { raw: 8, applied: 8 },
        livesAlone: { raw: 5, applied: 5 },
        chronicDisease: { raw: 4, applied: 4 },
        noCooling: { raw: 3, applied: 3 },
      },
      mitigation: {
        verifiedShelterCheckIn: { raw: 0, applied: 0 },
      },
    });
  });
});

describe("computeHri input boundary", () => {
  const invalidCases: Array<[string, Partial<Record<keyof HriInput, unknown>>]> = [
    ["NaN 체감온도", { feelsLikeC: Number.NaN }],
    ["무한대 체감온도", { feelsLikeC: Number.POSITIVE_INFINITY }],
    ["음의 무한대 체감온도", { feelsLikeC: Number.NEGATIVE_INFINITY }],
    ["최솟값 미만 체감온도", { feelsLikeC: -80.1 }],
    ["최댓값 초과 체감온도", { feelsLikeC: 80.1 }],
    ["음수 열대야 일수", { tropicalNightStreak: -1 }],
    ["소수 열대야 일수", { tropicalNightStreak: 1.5 }],
    ["범위 초과 열대야 일수", { tropicalNightStreak: 367 }],
    ["음수 고위험 계열 수", { medHigh: -1 }],
    ["소수 고위험 계열 수", { medHigh: 1.5 }],
    ["범위 초과 고위험 계열 수", { medHigh: 6 }],
    ["음수 중위험 계열 수", { medMid: -1 }],
    ["소수 중위험 계열 수", { medMid: 1.5 }],
    ["범위 초과 중위험 계열 수", { medMid: 9 }],
    ["음수 나이", { age: -1 }],
    ["소수 나이", { age: 70.5 }],
    ["범위 초과 나이", { age: 131 }],
    ["알 수 없는 특보 enum", { heatAdvisory: "ALERT" }],
    ["문자열 boolean", { medRegistered: "true" }],
    ["숫자 boolean", { livesAlone: 1 }],
    ["문자열 만성질환 boolean", { chronicDisease: "false" }],
    ["숫자 냉방 boolean", { noCooling: 0 }],
    ["문자열 체크인 boolean", { shelterCheckInVerified24h: "false" }],
  ];

  it.each(invalidCases)("%s 입력을 거부한다", (_label, override) => {
    expect(() => computeHri({ ...validInput, ...override } as HriInput)).toThrow();
  });

  it("알 수 없는 키를 거부한다", () => {
    expect(() => computeHri({ ...validInput, unexpected: "not-allowed" } as HriInput)).toThrow();
  });

  it("정의된 최솟값과 최댓값은 스키마와 계산 경계에서 허용한다", () => {
    const lowerBoundary = {
      ...validInput,
      feelsLikeC: -80,
      tropicalNightStreak: 0,
      medHigh: 0,
      medMid: 0,
      age: 0,
    };
    const upperBoundary = {
      ...validInput,
      feelsLikeC: 80,
      tropicalNightStreak: 366,
      medHigh: 5,
      medMid: 8,
      age: 130,
    };

    expect(HriInputSchema.parse(lowerBoundary)).toEqual(lowerBoundary);
    expect(() => computeHri(upperBoundary)).not.toThrow();
  });
});
