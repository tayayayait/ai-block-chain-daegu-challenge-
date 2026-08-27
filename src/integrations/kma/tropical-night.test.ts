import { describe, expect, it } from "vitest";

import {
  calculateTropicalNightStreak,
  summarizeTropicalNight,
  type TemperatureObservation,
} from "./tropical-night";

function hourlyNight(morningDate: string, temperatureC: number): TemperatureObservation[] {
  const morningStart = Date.parse(`${morningDate}T00:00:00+09:00`);
  return Array.from({ length: 16 }, (_, index) => ({
    observedAt: new Date(morningStart - 6 * 60 * 60_000 + index * 60 * 60_000).toISOString(),
    temperatureC,
  }));
}

describe("summarizeTropicalNight", () => {
  it("rejects an impossible KST calendar date", () => {
    expect(() => summarizeTropicalNight("2026-02-30", [])).toThrow(/calendar date/i);
  });

  it("uses the official 18:01-through-09:00 KST window and minimum temperature", () => {
    const observations = hourlyNight("2026-08-23", 26);
    observations.push({ observedAt: "2026-08-22T20:00:00+09:00", temperatureC: 24.9 });

    expect(summarizeTropicalNight("2026-08-23", observations)).toEqual({
      morningDate: "2026-08-23",
      minimumTemperatureC: 24.9,
      isTropicalNight: false,
      isComplete: true,
    });
  });

  it("marks a night partial instead of assuming zero when observations have a large gap", () => {
    const observations = hourlyNight("2026-08-23", 26).filter(({ observedAt }) => {
      const kstHour = (new Date(observedAt).getUTCHours() + 9) % 24;
      return kstHour !== 0 && kstHour !== 1;
    });

    expect(summarizeTropicalNight("2026-08-23", observations)).toMatchObject({
      isTropicalNight: null,
      isComplete: false,
    });
  });
});

describe("calculateTropicalNightStreak", () => {
  it("counts consecutive complete tropical nights backwards from the requested KST date", () => {
    const summaries = ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"].map((date) =>
      summarizeTropicalNight(date, hourlyNight(date, date === "2026-08-20" ? 24 : 26)),
    );

    expect(calculateTropicalNightStreak("2026-08-23", summaries)).toEqual({
      streak: 3,
      isPartial: false,
    });
  });

  it("stops at missing or incomplete data and reports partial", () => {
    const summaries = [
      summarizeTropicalNight("2026-08-21", hourlyNight("2026-08-21", 26)),
      summarizeTropicalNight("2026-08-23", hourlyNight("2026-08-23", 26)),
    ];

    expect(calculateTropicalNightStreak("2026-08-23", summaries)).toEqual({
      streak: 1,
      isPartial: true,
    });
  });
});
