import { describe, expect, it } from "vitest";

import {
  buildDepartureSlots,
  calculateDirectSunMinutes,
  selectRecommendedDeparture,
  type DepartureOptionMetrics,
} from "./departure-comparison";

describe("departure time comparison", () => {
  it("builds analysis anchors from now through the one-hour timeline limit", () => {
    expect(buildDepartureSlots(new Date("2026-08-26T06:00:00.000Z"))).toEqual([
      {
        offsetMinutes: 0,
        label: "지금 출발",
        departureAt: "2026-08-26T06:00:00.000Z",
      },
      {
        offsetMinutes: 30,
        label: "30분 후",
        departureAt: "2026-08-26T06:30:00.000Z",
      },
      {
        offsetMinutes: 60,
        label: "1시간 후",
        departureAt: "2026-08-26T07:00:00.000Z",
      },
    ]);
  });

  it("converts the unshaded share of a route into direct-sun minutes", () => {
    expect(calculateDirectSunMinutes(24 * 60, 0.52)).toBe(12);
    expect(calculateDirectSunMinutes(25 * 60, 0.74)).toBe(7);
    expect(calculateDirectSunMinutes(25 * 60, null)).toBeNull();
  });

  it("recommends the lowest combined heat, direct-sun, and duration burden", () => {
    const options: DepartureOptionMetrics[] = [
      option({ offsetMinutes: 0, feelsLikeC: 36, directSunMinutes: 18, durationMinutes: 24 }),
      option({ offsetMinutes: 30, feelsLikeC: 35, directSunMinutes: 14, durationMinutes: 24 }),
      option({ offsetMinutes: 60, feelsLikeC: 34, directSunMinutes: 9, durationMinutes: 25 }),
    ];

    expect(selectRecommendedDeparture(options)).toBe(60);
  });

  it("falls back to direct-sun and duration when forecast temperature is unavailable", () => {
    const options: DepartureOptionMetrics[] = [
      option({ offsetMinutes: 0, feelsLikeC: null, directSunMinutes: 18, durationMinutes: 24 }),
      option({ offsetMinutes: 30, feelsLikeC: null, directSunMinutes: 11, durationMinutes: 26 }),
      option({ offsetMinutes: 60, feelsLikeC: null, directSunMinutes: 9, durationMinutes: 25 }),
    ];

    expect(selectRecommendedDeparture(options)).toBe(60);
  });

  it("prefers the earlier departure when all measurable burdens are tied", () => {
    const options: DepartureOptionMetrics[] = [
      option({ offsetMinutes: 0 }),
      option({ offsetMinutes: 30 }),
      option({ offsetMinutes: 60 }),
    ];

    expect(selectRecommendedDeparture(options)).toBe(0);
  });
});

function option(
  overrides: Partial<DepartureOptionMetrics> & Pick<DepartureOptionMetrics, "offsetMinutes">,
): DepartureOptionMetrics {
  return {
    offsetMinutes: overrides.offsetMinutes,
    feelsLikeC: "feelsLikeC" in overrides ? (overrides.feelsLikeC ?? null) : 35,
    directSunMinutes: "directSunMinutes" in overrides ? (overrides.directSunMinutes ?? null) : 10,
    durationMinutes: overrides.durationMinutes ?? 25,
  };
}
