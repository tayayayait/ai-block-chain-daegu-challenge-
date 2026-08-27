import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createWeatherRepository, WeatherRepositoryError } from "./weather-repository.server";

type QueryResult = Readonly<{ data: unknown; error: { code?: string } | null }>;

function queryClient(result: QueryResult | readonly QueryResult[]) {
  const calls: Array<readonly [string, ...unknown[]]> = [];
  const results = Array.isArray(result) ? [...result] : [result];
  const query = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          const current = results.shift();
          if (!current) throw new Error("Missing mocked query result");
          return Promise.resolve(current).then.bind(Promise.resolve(current));
        }
        return (...args: unknown[]) => {
          calls.push([String(property), ...args]);
          return query;
        };
      },
    },
  );
  const from = vi.fn(() => query);
  return {
    client: { from } as unknown as SupabaseClient,
    calls,
    from,
  };
}

const persistedRow = {
  id: 7,
  location_key: "apihub:daegu-01",
  source: "KMA_APIHUB_500M",
  temperature_c: 30,
  humidity_pct: 60,
  feels_like_c: 34,
  advisory: "WATCH",
  tropical_night_streak: 2,
  is_partial: false,
  is_stale: false,
  error_code: null,
  observed_at: "2026-08-23T20:30:00+09:00",
  collected_at: "2026-08-23T20:31:00+09:00",
  expires_at: "2026-08-23T20:55:00+09:00",
} as const;

describe("createWeatherRepository", () => {
  it("reads the latest scoped snapshot and validates its DTO", async () => {
    const database = queryClient({ data: persistedRow, error: null });
    const repository = createWeatherRepository(database.client);

    await expect(
      repository.findLatestValidSnapshot({
        locationKeys: ["apihub:daegu-01", "village:89:90"],
        beforeOrAt: "2026-08-23T21:00:00+09:00",
      }),
    ).resolves.toEqual(persistedRow);
    expect(database.from).toHaveBeenCalledWith("weather_snapshots");
    expect(database.calls).toContainEqual([
      "in",
      "location_key",
      ["apihub:daegu-01", "village:89:90"],
    ]);
    expect(database.calls).toContainEqual(["order", "observed_at", { ascending: false }]);
    expect(database.calls).toContainEqual(["order", "collected_at", { ascending: false }]);
  });

  it("returns null when no previous snapshot exists", async () => {
    const database = queryClient({ data: null, error: null });
    const repository = createWeatherRepository(database.client);

    await expect(
      repository.findLatestValidSnapshot({
        locationKeys: ["apihub:daegu-01", "village:89:90"],
        beforeOrAt: "2026-08-23T21:00:00+09:00",
      }),
    ).resolves.toBeNull();
  });

  it("summarizes APIHub temperature rows in official tropical-night windows", async () => {
    const observations = [
      {
        observed_at: "2026-08-21T18:10:00+09:00",
        collected_at: "2026-08-21T18:11:00+09:00",
        temperature_c: 25.8,
      },
      {
        observed_at: "2026-08-21T23:30:00+09:00",
        collected_at: "2026-08-21T23:31:00+09:00",
        temperature_c: 24.1,
      },
      {
        observed_at: "2026-08-21T23:30:00+09:00",
        collected_at: "2026-08-21T23:40:00+09:00",
        temperature_c: 25.1,
      },
      {
        observed_at: "2026-08-22T08:50:00+09:00",
        collected_at: "2026-08-22T08:51:00+09:00",
        temperature_c: 25.4,
      },
      {
        observed_at: "2026-08-22T18:10:00+09:00",
        collected_at: "2026-08-22T18:11:00+09:00",
        temperature_c: 25.7,
      },
      {
        observed_at: "2026-08-23T08:50:00+09:00",
        collected_at: "2026-08-23T08:51:00+09:00",
        temperature_c: 24.9,
      },
    ];
    const database = queryClient({ data: observations, error: null });
    const repository = createWeatherRepository(database.client);

    const summaries = await repository.listTropicalNightSummaries({
      apiHubLocationKey: "apihub:daegu-01",
      throughMorningDate: "2026-08-23",
    });

    expect(summaries).toHaveLength(367);
    expect(summaries.at(-2)).toMatchObject({
      morningDate: "2026-08-22",
      minimumTemperatureC: 25.1,
      isTropicalNight: null,
      isComplete: false,
    });
    expect(summaries.at(-1)).toMatchObject({
      morningDate: "2026-08-23",
      minimumTemperatureC: 24.9,
      isTropicalNight: null,
      isComplete: false,
    });
    expect(database.calls).toContainEqual(["eq", "source", "KMA_APIHUB_500M"]);
    expect(database.calls).toContainEqual(["order", "collected_at", { ascending: false }]);
  });

  it("inserts idempotently without depending on one specific conflict constraint", async () => {
    const database = queryClient({ data: { id: 19 }, error: null });
    const repository = createWeatherRepository(database.client);

    await expect(
      repository.upsertWeatherSnapshot({
        location_key: "village:89:90",
        source: "KMA_VILLAGE_FCST",
        location: "SRID=4326;POINT(128.6014 35.8714)",
        kma_nx: 89,
        kma_ny: 90,
        temperature_c: 30,
        humidity_pct: 60,
        feels_like_c: 34,
        advisory: "NONE",
        tropical_night_streak: 0,
        is_partial: true,
        is_stale: false,
        error_code: null,
        observed_at: "2026-08-23T20:00:00+09:00",
        collected_at: "2026-08-23T20:01:00+09:00",
        expires_at: "2026-08-23T20:25:00+09:00",
      }),
    ).resolves.toEqual({ id: 19 });
    expect(database.calls).toContainEqual(["insert", expect.any(Object)]);
    expect(database.calls.some(([method]) => method === "upsert")).toBe(false);
  });

  it("resolves a duplicate against both the collection key and the legacy observation key", async () => {
    const database = queryClient([
      { data: null, error: { code: "23505" } },
      { data: null, error: null },
      { data: { id: 18 }, error: null },
    ]);
    const repository = createWeatherRepository(database.client);

    await expect(
      repository.upsertWeatherSnapshot({
        location_key: "village:89:90",
        source: "KMA_VILLAGE_FCST",
        location: "SRID=4326;POINT(128.6014 35.8714)",
        kma_nx: 89,
        kma_ny: 90,
        temperature_c: 30,
        humidity_pct: 60,
        feels_like_c: 34,
        advisory: "NONE",
        tropical_night_streak: 0,
        is_partial: true,
        is_stale: true,
        error_code: "KMA_UPSTREAM_UNAVAILABLE",
        observed_at: "2026-08-23T20:00:00+09:00",
        collected_at: "2026-08-23T20:05:00+09:00",
        expires_at: "2026-08-23T20:30:00+09:00",
      }),
    ).resolves.toEqual({ id: 18 });

    expect(database.calls).toContainEqual(["eq", "collected_at", "2026-08-23T20:05:00+09:00"]);
    expect(database.calls).toContainEqual(["order", "collected_at", { ascending: false }]);
  });

  it("maps database and schema failures to a safe repository error", async () => {
    const failed = queryClient({ data: null, error: { code: "42501" } });
    const malformed = queryClient({ data: { id: "secret raw value" }, error: null });

    await expect(
      createWeatherRepository(failed.client).findLatestValidSnapshot({
        locationKeys: ["apihub:daegu-01", "village:89:90"],
        beforeOrAt: "2026-08-23T21:00:00+09:00",
      }),
    ).rejects.toEqual(new WeatherRepositoryError("WEATHER_REPOSITORY_QUERY_FAILED"));
    await expect(
      createWeatherRepository(malformed.client).upsertWeatherSnapshot({
        location_key: "village:89:90",
        source: "KMA_VILLAGE_FCST",
        location: "SRID=4326;POINT(128.6014 35.8714)",
        kma_nx: 89,
        kma_ny: 90,
        temperature_c: 30,
        humidity_pct: 60,
        feels_like_c: 34,
        advisory: "NONE",
        tropical_night_streak: 0,
        is_partial: true,
        is_stale: false,
        error_code: null,
        observed_at: "2026-08-23T20:00:00+09:00",
        collected_at: "2026-08-23T20:01:00+09:00",
        expires_at: "2026-08-23T20:25:00+09:00",
      }),
    ).rejects.toEqual(new WeatherRepositoryError("WEATHER_REPOSITORY_INVALID_RESPONSE"));
  });
});
