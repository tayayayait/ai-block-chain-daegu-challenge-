import { describe, expect, it, vi } from "vitest";

import type { KmaClient } from "@/integrations/kma/kma.server";
import { summerApparentTemperatureC } from "@/integrations/kma/weather";
import { loadLiveHomeSummary, unavailableLiveHomeSummary } from "./live-summary.server";

const NOW = new Date("2026-08-24T12:40:00+09:00");

function kmaClient(overrides: Partial<KmaClient> = {}): KmaClient {
  return {
    getPointObservations: vi.fn(async () => []),
    getCurrentHeatWarnings: vi.fn(async () => []),
    getVillageForecast: vi.fn(async () => []),
    ...overrides,
  };
}

describe("public live home summary", () => {
  it("creates a numeric-default-free unavailable DTO when server configuration cannot load", () => {
    expect(unavailableLiveHomeSummary(NOW)).toEqual({
      fetchedAt: NOW.toISOString(),
      weather: null,
      heatAdvisory: null,
      shelterCount: null,
      availability: {
        weather: "UNAVAILABLE",
        heatAdvisory: "UNAVAILABLE",
        shelters: "UNAVAILABLE",
      },
    });
  });

  it("publishes only the newest complete KMA observation, current advisory, and exact shelter count", async () => {
    const getVillageForecast = vi.fn(async () => []);
    const client = kmaClient({
      getPointObservations: vi.fn(async () => [
        {
          observedAt: "2026-08-24T12:30:00+09:00",
          apparentTemperatureC: 34.8,
          airTemperatureC: 33.1,
          relativeHumidityPct: 62,
        },
        {
          observedAt: "2026-08-24T12:35:00+09:00",
          apparentTemperatureC: null,
          airTemperatureC: 33.3,
          relativeHumidityPct: 61,
        },
      ]),
      getCurrentHeatWarnings: vi.fn(async () => [
        {
          regionCode: "11H10701",
          regionName: "대구광역시",
          issuedAt: "2026-08-24T09:00:00+09:00",
          effectiveAt: "2026-08-24T10:00:00+09:00",
          kind: "HEAT" as const,
          level: "WATCH" as const,
          command: "유지",
        },
        {
          regionCode: "11H10701",
          regionName: "대구광역시",
          issuedAt: "2026-08-24T11:00:00+09:00",
          effectiveAt: "2026-08-24T12:00:00+09:00",
          kind: "HEAT" as const,
          level: "WARNING" as const,
          command: "대치",
        },
      ]),
      getVillageForecast,
    });

    const result = await loadLiveHomeSummary({
      kmaClient: client,
      countShelters: async () => 950,
      now: () => NOW,
    });

    expect(result).toEqual({
      fetchedAt: NOW.toISOString(),
      weather: {
        source: "KMA_APIHUB_500M",
        observedAt: "2026-08-24T12:30:00+09:00",
        feelsLikeC: 34.8,
        airTemperatureC: 33.1,
        relativeHumidityPct: 62,
      },
      heatAdvisory: "WARNING",
      shelterCount: 950,
      availability: {
        weather: "AVAILABLE",
        heatAdvisory: "AVAILABLE",
        shelters: "AVAILABLE",
      },
    });
    expect(getVillageForecast).not.toHaveBeenCalled();
  });

  it("uses the nearest real village forecast without inventing an advisory or shelter count", async () => {
    const client = kmaClient({
      getPointObservations: vi.fn(async () => {
        throw new Error("KMA point unavailable");
      }),
      getCurrentHeatWarnings: vi.fn(async () => {
        throw new Error("KMA warnings unavailable");
      }),
      getVillageForecast: vi.fn(async () => [
        {
          forecastAt: "2026-08-24T12:00:00+09:00",
          airTemperatureC: 32,
          relativeHumidityPct: 70,
          grid: { nx: 89, ny: 90 },
        },
        {
          forecastAt: "2026-08-24T13:00:00+09:00",
          airTemperatureC: 33,
          relativeHumidityPct: 64,
          grid: { nx: 89, ny: 90 },
        },
      ]),
    });

    const result = await loadLiveHomeSummary({
      kmaClient: client,
      countShelters: async () => {
        throw new Error("Supabase unavailable");
      },
      now: () => NOW,
    });

    expect(result.weather).toEqual({
      source: "KMA_VILLAGE_FCST",
      observedAt: "2026-08-24T13:00:00+09:00",
      feelsLikeC: summerApparentTemperatureC(33, 64),
      airTemperatureC: 33,
      relativeHumidityPct: 64,
    });
    expect(result.heatAdvisory).toBeNull();
    expect(result.shelterCount).toBeNull();
    expect(result.availability).toEqual({
      weather: "AVAILABLE",
      heatAdvisory: "UNAVAILABLE",
      shelters: "UNAVAILABLE",
    });
  });

  it("does not publish an observation older than the three-hour public freshness window", async () => {
    const client = kmaClient({
      getPointObservations: vi.fn(async () => [
        {
          observedAt: "2026-08-24T09:39:59+09:00",
          apparentTemperatureC: 33.8,
          airTemperatureC: 31.2,
          relativeHumidityPct: 67,
        },
      ]),
      getVillageForecast: vi.fn(async () => [
        {
          forecastAt: "2026-08-24T13:00:00+09:00",
          airTemperatureC: 33,
          relativeHumidityPct: 64,
          grid: { nx: 89, ny: 90 },
        },
      ]),
    });

    const result = await loadLiveHomeSummary({
      kmaClient: client,
      countShelters: async () => 950,
      now: () => NOW,
    });

    expect(result.weather?.source).toBe("KMA_VILLAGE_FCST");
    expect(result.weather?.observedAt).toBe("2026-08-24T13:00:00+09:00");
  });

  it("does not publish a village forecast farther than three hours from now", async () => {
    const client = kmaClient({
      getPointObservations: vi.fn(async () => []),
      getVillageForecast: vi.fn(async () => [
        {
          forecastAt: "2026-08-24T15:40:01+09:00",
          airTemperatureC: 35,
          relativeHumidityPct: 55,
          grid: { nx: 89, ny: 90 },
        },
      ]),
    });

    const result = await loadLiveHomeSummary({
      kmaClient: client,
      countShelters: async () => 950,
      now: () => NOW,
    });

    expect(result.weather).toBeNull();
    expect(result.availability.weather).toBe("UNAVAILABLE");
  });

  it("returns explicit unavailable states within a bounded time when providers never settle", async () => {
    vi.useFakeTimers();
    try {
      const never = () => new Promise<never>(() => undefined);
      const resultPromise = loadLiveHomeSummary({
        kmaClient: kmaClient({
          getPointObservations: vi.fn(never),
          getCurrentHeatWarnings: vi.fn(never),
          getVillageForecast: vi.fn(never),
        }),
        countShelters: never,
        now: () => NOW,
        operationTimeoutMs: 100,
      });

      await vi.advanceTimersByTimeAsync(250);
      await expect(resultPromise).resolves.toMatchObject({
        weather: null,
        heatAdvisory: null,
        shelterCount: null,
        availability: {
          weather: "UNAVAILABLE",
          heatAdvisory: "UNAVAILABLE",
          shelters: "UNAVAILABLE",
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns explicit unavailable states when no trusted live weather exists", async () => {
    const client = kmaClient({
      getPointObservations: vi.fn(async () => []),
      getCurrentHeatWarnings: vi.fn(async () => []),
      getVillageForecast: vi.fn(async () => {
        throw new Error("KMA village forecast unavailable");
      }),
    });

    const result = await loadLiveHomeSummary({
      kmaClient: client,
      countShelters: async () => 0,
      now: () => NOW,
    });

    expect(result.weather).toBeNull();
    expect(result.heatAdvisory).toBe("NONE");
    expect(result.shelterCount).toBe(0);
    expect(result.availability).toEqual({
      weather: "UNAVAILABLE",
      heatAdvisory: "AVAILABLE",
      shelters: "AVAILABLE",
    });
  });

  it("does not expose a future warning as currently effective", async () => {
    const client = kmaClient({
      getCurrentHeatWarnings: vi.fn(async () => [
        {
          regionCode: "11H10701",
          regionName: "대구광역시",
          issuedAt: "2026-08-24T12:30:00+09:00",
          effectiveAt: "2026-08-24T13:00:00+09:00",
          kind: "HEAT" as const,
          level: "WARNING" as const,
          command: "발표",
        },
      ]),
    });

    const result = await loadLiveHomeSummary({
      kmaClient: client,
      countShelters: async () => 950,
      now: () => NOW,
    });

    expect(result.heatAdvisory).toBe("NONE");
    expect(result.availability.heatAdvisory).toBe("AVAILABLE");
  });

  it("ignores a higher warning outside Daegu when Daegu only has a watch", async () => {
    const client = kmaClient({
      getCurrentHeatWarnings: vi.fn(async () => [
        {
          regionCode: "11H20201",
          regionName: "부산광역시",
          issuedAt: "2026-08-24T10:00:00+09:00",
          effectiveAt: "2026-08-24T11:00:00+09:00",
          kind: "HEAT" as const,
          level: "WARNING" as const,
          command: "유지",
        },
        {
          regionCode: "11H10701",
          regionName: "대구광역시",
          issuedAt: "2026-08-24T10:00:00+09:00",
          effectiveAt: "2026-08-24T11:00:00+09:00",
          kind: "HEAT" as const,
          level: "WATCH" as const,
          command: "유지",
        },
      ]),
    });

    const result = await loadLiveHomeSummary({
      kmaClient: client,
      countShelters: async () => 950,
      now: () => NOW,
    });

    expect(result.heatAdvisory).toBe("WATCH");
  });

  it("treats a successful response containing only non-Daegu warnings as no Daegu advisory", async () => {
    const client = kmaClient({
      getCurrentHeatWarnings: vi.fn(async () => [
        {
          regionCode: "11H20201",
          regionName: "부산광역시",
          issuedAt: "2026-08-24T10:00:00+09:00",
          effectiveAt: "2026-08-24T11:00:00+09:00",
          kind: "HEAT" as const,
          level: "WARNING" as const,
          command: "유지",
        },
      ]),
    });

    const result = await loadLiveHomeSummary({
      kmaClient: client,
      countShelters: async () => 950,
      now: () => NOW,
    });

    expect(result.heatAdvisory).toBe("NONE");
    expect(result.availability.heatAdvisory).toBe("AVAILABLE");
  });

  it("does not accept a non-official region merely because its name contains Daegu", async () => {
    const client = kmaClient({
      getCurrentHeatWarnings: vi.fn(async () => [
        {
          regionCode: "OTHER",
          regionName: "신대구산광역시",
          issuedAt: "2026-08-24T10:00:00+09:00",
          effectiveAt: "2026-08-24T11:00:00+09:00",
          kind: "HEAT" as const,
          level: "WARNING" as const,
          command: "유지",
        },
      ]),
    });

    const result = await loadLiveHomeSummary({
      kmaClient: client,
      countShelters: async () => 950,
      now: () => NOW,
    });

    expect(result.heatAdvisory).toBe("NONE");
  });
});
