import { describe, expect, it, vi } from "vitest";

import type { KmaClient } from "./kma.server";
import type { TropicalNightSummary } from "./tropical-night";
import {
  buildWeatherLocationKeys,
  createWeatherService,
  selectActiveDaeguHeatWarning,
  WeatherPersistenceError,
  type PersistedWeatherSnapshot,
  type WeatherRepository,
  type WeatherServiceLogger,
} from "./weather-service.server";

const NOW = "2026-08-23T15:00:00+09:00";
const LOCATION = {
  apiHubCellId: "HR-DAEGU-500M-001",
  longitude: 128.603552777777,
  latitude: 35.8685416666666,
  kmaGrid: { nx: 89, ny: 90 },
} as const;

const completeSummaries: TropicalNightSummary[] = [
  {
    morningDate: "2026-08-20",
    minimumTemperatureC: 24.8,
    isTropicalNight: false,
    isComplete: true,
  },
  {
    morningDate: "2026-08-21",
    minimumTemperatureC: 25.2,
    isTropicalNight: true,
    isComplete: true,
  },
  {
    morningDate: "2026-08-22",
    minimumTemperatureC: 25.8,
    isTropicalNight: true,
    isComplete: true,
  },
  {
    morningDate: "2026-08-23",
    minimumTemperatureC: 26.1,
    isTropicalNight: true,
    isComplete: true,
  },
];

function client(overrides: Partial<KmaClient> = {}): KmaClient {
  return {
    getPointObservations: vi.fn(async () => [
      {
        observedAt: "2026-08-23T14:40:00+09:00",
        apparentTemperatureC: 34.6,
        airTemperatureC: 32.4,
        relativeHumidityPct: 59,
      },
    ]),
    getCurrentHeatWarnings: vi.fn(async () => [
      {
        regionCode: "L1070100",
        regionName: "대구",
        issuedAt: "2026-08-23T11:00:00+09:00",
        effectiveAt: "2026-08-23T12:00:00+09:00",
        kind: "HEAT" as const,
        level: "WATCH" as const,
        command: "1",
      },
    ]),
    getVillageForecast: vi.fn(async () => [
      {
        forecastAt: "2026-08-23T15:00:00+09:00",
        airTemperatureC: 33,
        relativeHumidityPct: 58,
        grid: { nx: 89, ny: 90 },
      },
    ]),
    ...overrides,
  };
}

function snapshot(overrides: Partial<PersistedWeatherSnapshot> = {}): PersistedWeatherSnapshot {
  return {
    id: 41,
    location_key: "apihub:HR-DAEGU-500M-001",
    source: "KMA_APIHUB_500M",
    temperature_c: 31.8,
    humidity_pct: 61,
    feels_like_c: 34.1,
    advisory: "WATCH",
    tropical_night_streak: 2,
    is_partial: false,
    is_stale: false,
    error_code: null,
    observed_at: "2026-08-23T12:01:00+09:00",
    collected_at: "2026-08-23T12:05:00+09:00",
    expires_at: "2026-08-23T12:30:00+09:00",
    ...overrides,
  };
}

function repository(
  input: {
    latest?: PersistedWeatherSnapshot | null;
    summaries?: readonly TropicalNightSummary[];
    upsertError?: Error;
  } = {},
): WeatherRepository {
  return {
    findLatestValidSnapshot: vi.fn(async () => input.latest ?? null),
    listTropicalNightSummaries: vi.fn(async () => input.summaries ?? completeSummaries),
    upsertWeatherSnapshot: vi.fn(async (row) => {
      if (input.upsertError) throw input.upsertError;
      return { id: 99, row };
    }),
  };
}

function service(
  input: {
    kmaClient?: KmaClient;
    repository?: WeatherRepository;
    logger?: WeatherServiceLogger;
  } = {},
) {
  return createWeatherService({
    kmaClient: input.kmaClient ?? client(),
    repository: input.repository ?? repository(),
    clock: { now: () => new Date(NOW) },
    ...(input.logger ? { logger: input.logger } : {}),
  });
}

describe("weather location cache namespaces", () => {
  it("keeps APIHub 500m cells separate from village forecast grids", () => {
    expect(buildWeatherLocationKeys(LOCATION)).toEqual({
      apiHub: "apihub:HR-DAEGU-500M-001",
      village: "village:89:90",
    });
  });
});

describe("selectActiveDaeguHeatWarning", () => {
  it("ignores future/non-Daegu warnings and prefers the active warning level", () => {
    expect(
      selectActiveDaeguHeatWarning(
        [
          {
            regionCode: "BUSAN",
            regionName: "부산",
            issuedAt: "2026-08-23T09:00:00+09:00",
            effectiveAt: "2026-08-23T10:00:00+09:00",
            kind: "HEAT",
            level: "WARNING",
            command: "1",
          },
          {
            regionCode: "DAEGU-FUTURE",
            regionName: "대구",
            issuedAt: "2026-08-23T15:01:00+09:00",
            effectiveAt: "2026-08-23T16:00:00+09:00",
            kind: "HEAT",
            level: "WARNING",
            command: "1",
          },
          {
            regionCode: "DAEGU-WATCH",
            regionName: "대구광역시",
            issuedAt: "2026-08-23T10:00:00+09:00",
            effectiveAt: "2026-08-23T11:00:00+09:00",
            kind: "HEAT",
            level: "WATCH",
            command: "1",
          },
          {
            regionCode: "DAEGU-WARNING",
            regionName: "대구",
            issuedAt: "2026-08-23T11:00:00+09:00",
            effectiveAt: "2026-08-23T12:00:00+09:00",
            kind: "HEAT",
            level: "WARNING",
            command: "1",
          },
        ],
        NOW,
      )?.regionCode,
    ).toBe("DAEGU-WARNING");
  });
});

describe("createWeatherService", () => {
  it("uses the latest complete past APIHub row and persists an auditable snapshot DTO", async () => {
    const kmaClient = client({
      getPointObservations: vi.fn(async () => [
        {
          observedAt: "2026-08-23T14:40:00+09:00",
          apparentTemperatureC: 34.6,
          airTemperatureC: 32.4,
          relativeHumidityPct: 59,
        },
        {
          observedAt: "2026-08-23T14:50:00+09:00",
          apparentTemperatureC: null,
          airTemperatureC: 32.6,
          relativeHumidityPct: 58,
        },
        {
          observedAt: "2026-08-23T15:05:00+09:00",
          apparentTemperatureC: 35,
          airTemperatureC: 33,
          relativeHumidityPct: 58,
        },
      ]),
    });
    const weatherRepository = repository();

    const result = await service({ kmaClient, repository: weatherRepository }).resolve(LOCATION);

    expect(result.selection).toMatchObject({
      mode: "PRIMARY",
      state: "success",
      isStale: false,
      errorCode: null,
      reading: {
        source: "KMA_APIHUB_500M",
        observedAt: "2026-08-23T14:40:00+09:00",
        advisory: "WATCH",
        tropicalNightStreak: 3,
        tropicalNightPartial: false,
      },
    });
    expect(result.weatherSnapshotId).toBe(99);
    expect(kmaClient.getVillageForecast).not.toHaveBeenCalled();
    expect(weatherRepository.upsertWeatherSnapshot).toHaveBeenCalledWith({
      location_key: "apihub:HR-DAEGU-500M-001",
      source: "KMA_APIHUB_500M",
      location: "SRID=4326;POINT(128.603552777777 35.8685416666666)",
      kma_nx: 89,
      kma_ny: 90,
      temperature_c: 32.4,
      humidity_pct: 59,
      feels_like_c: 34.6,
      advisory: "WATCH",
      tropical_night_streak: 3,
      is_partial: false,
      is_stale: false,
      error_code: null,
      observed_at: "2026-08-23T14:40:00+09:00",
      collected_at: NOW,
      expires_at: "2026-08-23T15:25:00.000+09:00",
    });
  });

  it("falls back to the latest forecast slot that is not in the future and passes partial tropical-night state", async () => {
    const secret = "RAW-PROVIDER-SECRET";
    const logs: unknown[] = [];
    const kmaClient = client({
      getPointObservations: vi.fn(async () => {
        throw new Error(secret);
      }),
      getVillageForecast: vi.fn(async () => [
        {
          forecastAt: "2026-08-23T14:00:00+09:00",
          airTemperatureC: 32,
          relativeHumidityPct: 60,
          grid: { nx: 89, ny: 90 },
        },
        {
          forecastAt: "2026-08-23T15:00:00+09:00",
          airTemperatureC: 33,
          relativeHumidityPct: 58,
          grid: { nx: 89, ny: 90 },
        },
        {
          forecastAt: "2026-08-23T16:00:00+09:00",
          airTemperatureC: 34,
          relativeHumidityPct: 57,
          grid: { nx: 89, ny: 90 },
        },
      ]),
    });
    const weatherRepository = repository({ summaries: completeSummaries.slice(1) });

    const result = await service({
      kmaClient,
      repository: weatherRepository,
      logger: (event) => logs.push(event),
    }).resolve(LOCATION);

    expect(result.selection).toMatchObject({
      mode: "FALLBACK",
      state: "partial",
      errorCode: "KMA_PRIMARY_UNAVAILABLE",
      reading: {
        source: "KMA_VILLAGE_FCST",
        observedAt: "2026-08-23T15:00:00+09:00",
        tropicalNightStreak: 3,
        tropicalNightPartial: true,
      },
    });
    expect(weatherRepository.upsertWeatherSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        location_key: "village:89:90",
        source: "KMA_VILLAGE_FCST",
        is_partial: true,
        error_code: "KMA_PRIMARY_UNAVAILABLE",
      }),
    );
    expect(JSON.stringify(logs)).not.toContain(secret);
    expect(logs).toContainEqual({
      event: "weather_provider_failed",
      stage: "PRIMARY",
      code: "KMA_PRIMARY_FAILED",
    });
  });

  it("persists and reports a partial primary snapshot when warning lookup fails", async () => {
    const warningSecret = "RAW-WARNING-PROVIDER-BODY";
    const logs: unknown[] = [];
    const kmaClient = client({
      getCurrentHeatWarnings: vi.fn(async () => {
        throw new Error(warningSecret);
      }),
    });
    const weatherRepository = repository({
      latest: snapshot({ advisory: "WARNING" }),
    });

    const result = await service({
      kmaClient,
      repository: weatherRepository,
      logger: (event) => logs.push(event),
    }).resolve(LOCATION);

    expect(kmaClient.getPointObservations).toHaveBeenCalledOnce();
    expect(kmaClient.getVillageForecast).not.toHaveBeenCalled();
    expect(result.selection).toMatchObject({
      mode: "PRIMARY",
      state: "partial",
      isStale: false,
      errorCode: "KMA_WARNING_UNAVAILABLE",
      reading: { advisory: "WARNING" },
    });
    expect(weatherRepository.upsertWeatherSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        advisory: "WARNING",
        is_partial: true,
        is_stale: false,
        error_code: "KMA_WARNING_UNAVAILABLE",
      }),
    );
    expect(JSON.stringify(logs)).not.toContain(warningSecret);
    expect(logs).toContainEqual({
      event: "weather_provider_failed",
      stage: "WARNING",
      code: "KMA_WARNING_FAILED",
    });
  });

  it("uses a recent snapshot for at most three hours when both live sources fail", async () => {
    const latest = snapshot();
    const weatherRepository = repository({ latest });
    const kmaClient = client({
      getPointObservations: vi.fn(async () => {
        throw new Error("primary body");
      }),
      getVillageForecast: vi.fn(async () => {
        throw new Error("fallback body");
      }),
    });

    const result = await service({ kmaClient, repository: weatherRepository }).resolve(LOCATION);

    expect(result.selection.mode).toBe("CACHE");
    expect(result.selection.state).toBe("partial");
    expect(result.selection.isStale).toBe(true);
    expect(result.selection.errorCode).toBe("KMA_UPSTREAM_UNAVAILABLE");
    expect(result.weatherSnapshotId).toBe(99);
    expect(weatherRepository.upsertWeatherSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        is_partial: true,
        is_stale: true,
        error_code: "KMA_UPSTREAM_UNAVAILABLE",
        observed_at: latest.observed_at,
        collected_at: NOW,
      }),
    );
  });

  it("keeps an older last-valid snapshot instead of substituting E=0", async () => {
    const latest = snapshot({ observed_at: "2026-08-23T10:00:00+09:00" });
    const kmaClient = client({
      getPointObservations: vi.fn(async () => Promise.reject(new Error("primary"))),
      getVillageForecast: vi.fn(async () => Promise.reject(new Error("fallback"))),
    });

    const result = await service({
      kmaClient,
      repository: repository({ latest }),
    }).resolve(LOCATION);

    expect(result.selection.mode).toBe("LAST_VALID");
    expect(result.selection.state).toBe("partial");
    expect(result.selection.isStale).toBe(true);
    expect(result.selection.errorCode).toBe("KMA_UPSTREAM_UNAVAILABLE");
    expect(result.weatherSnapshotId).toBe(99);
  });

  it("treats an all-future fallback response as unavailable and reuses cache", async () => {
    const kmaClient = client({
      getPointObservations: vi.fn(async () => Promise.reject(new Error("primary"))),
      getVillageForecast: vi.fn(async () => [
        {
          forecastAt: "2026-08-23T16:00:00+09:00",
          airTemperatureC: 34,
          relativeHumidityPct: 57,
          grid: { nx: 89, ny: 90 },
        },
      ]),
    });

    const result = await service({
      kmaClient,
      repository: repository({ latest: snapshot() }),
    }).resolve(LOCATION);

    expect(result.selection.mode).toBe("CACHE");
  });

  it("returns only the stable fail-safe error when no live or persisted value exists", async () => {
    const secret = "KEY-AND-UPSTREAM-BODY-MUST-NOT-LEAK";
    const logs: unknown[] = [];
    const kmaClient = client({
      getPointObservations: vi.fn(async () => Promise.reject(new Error(secret))),
      getVillageForecast: vi.fn(async () => Promise.reject(new Error(secret))),
    });

    let message = "";
    try {
      await service({
        kmaClient,
        repository: repository(),
        logger: (event) => logs.push(event),
      }).resolve(LOCATION);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("No valid weather input is available; risk recomputation must be skipped");
    expect(JSON.stringify(logs)).not.toContain(secret);
  });

  it("converts persistence failures into a stable code without leaking the database message", async () => {
    const secret = "DATABASE-CONNECTION-SECRET";
    await expect(
      service({
        repository: repository({ upsertError: new Error(secret) }),
      }).resolve(LOCATION),
    ).rejects.toEqual(expect.objectContaining({ code: "WEATHER_SNAPSHOT_PERSIST_FAILED" }));

    let message = "";
    try {
      await service({
        repository: repository({ upsertError: new Error(secret) }),
      }).resolve(LOCATION);
    } catch (error) {
      expect(error).toBeInstanceOf(WeatherPersistenceError);
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(secret);
  });
});
