import { describe, expect, it } from "vitest";

import {
  createVillageFallbackCandidate,
  selectRiskWeather,
  WeatherUnavailableError,
  type WeatherCandidate,
} from "./weather-policy";

const NOW = "2026-08-23T15:00:00+09:00";

function candidate(overrides: Partial<WeatherCandidate> = {}): WeatherCandidate {
  return {
    source: "KMA_APIHUB_500M",
    observedAt: "2026-08-23T14:40:00+09:00",
    airTemperatureC: 32.4,
    relativeHumidityPct: 59,
    feelsLikeC: 34.6,
    advisory: "WATCH",
    tropicalNightStreak: 3,
    tropicalNightPartial: false,
    ...overrides,
  };
}

describe("selectRiskWeather", () => {
  it("prefers a complete APIHub 500m candidate and assigns a 25-minute TTL", () => {
    const result = selectRiskWeather({ now: NOW, primary: candidate() });

    expect(result).toMatchObject({
      mode: "PRIMARY",
      state: "success",
      isStale: false,
      errorCode: null,
    });
    expect(result.expiresAt).toBe("2026-08-23T15:25:00.000+09:00");
  });

  it("falls back to village TMP/REH and uses the official apparent-temperature formula", () => {
    const fallback = createVillageFallbackCandidate({
      forecastAt: "2026-08-23T15:00:00+09:00",
      airTemperatureC: 33,
      relativeHumidityPct: 58,
      advisory: "NONE",
      tropicalNightStreak: 0,
      tropicalNightPartial: false,
    });

    const result = selectRiskWeather({ now: NOW, primary: null, fallback });

    expect(result.mode).toBe("FALLBACK");
    expect(result.state).toBe("partial");
    expect(result.errorCode).toBe("KMA_PRIMARY_UNAVAILABLE");
    expect(result.reading.feelsLikeC).toBeCloseTo(33.2639, 4);
  });

  it("uses a recent cached value for at most three hours", () => {
    const cached = candidate({ observedAt: "2026-08-23T12:01:00+09:00" });
    const result = selectRiskWeather({ now: NOW, primary: null, fallback: null, cached });

    expect(result).toMatchObject({
      mode: "CACHE",
      state: "partial",
      isStale: true,
      errorCode: "KMA_UPSTREAM_UNAVAILABLE",
      shouldPersistWeatherSnapshot: true,
    });
  });

  it("keeps the last valid environment after the three-hour cache window", () => {
    const lastValid = candidate({ observedAt: "2026-08-23T10:00:00+09:00" });
    const result = selectRiskWeather({
      now: NOW,
      primary: null,
      fallback: null,
      cached: lastValid,
      lastValid,
    });

    expect(result.mode).toBe("LAST_VALID");
    expect(result.state).toBe("partial");
    expect(result.isStale).toBe(true);
    expect(result.shouldPersistWeatherSnapshot).toBe(true);
  });

  it("stops recomputation when the last valid environment is more than 24 hours old", () => {
    const lastValid = candidate({ observedAt: "2026-08-22T14:59:59+09:00" });

    expect(() =>
      selectRiskWeather({
        now: NOW,
        primary: null,
        fallback: null,
        cached: lastValid,
        lastValid,
      }),
    ).toThrow(WeatherUnavailableError);
  });

  it("fails closed so callers skip recomputation instead of substituting E=0", () => {
    expect(() => selectRiskWeather({ now: NOW, primary: null, fallback: null })).toThrow(
      WeatherUnavailableError,
    );
  });
});
