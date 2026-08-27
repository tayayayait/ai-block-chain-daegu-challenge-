import "@tanstack/react-start/server-only";

import { z } from "zod";
import type { HeatAdvisory } from "@/lib/domain-types";
import { KmaProviderError, type KmaClient } from "./kma.server";
import { calculateTropicalNightStreak, type TropicalNightSummary } from "./tropical-night";
import type { Kma500mPointObservation, KmaHeatWarning, VilageForecastSlot } from "./weather";
import {
  createVillageFallbackCandidate,
  selectRiskWeather,
  type WeatherCandidate,
  type WeatherSelection,
} from "./weather-policy";

const TimestampSchema = z.string().datetime({ offset: true });
const WeatherLocationSchema = z
  .object({
    apiHubCellId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/),
    longitude: z.number().finite().min(124).max(132),
    latitude: z.number().finite().min(32).max(40),
    kmaGrid: z.object({
      nx: z.number().int().positive(),
      ny: z.number().int().positive(),
    }),
  })
  .strict();

const PersistedWeatherSnapshotSchema = z
  .object({
    id: z.number().int().positive(),
    location_key: z.string().min(1),
    source: z.enum(["KMA_APIHUB_500M", "KMA_VILLAGE_FCST"]),
    temperature_c: z.number().finite().min(-80).max(80),
    humidity_pct: z.number().finite().min(0).max(100),
    feels_like_c: z.number().finite().min(-80).max(80),
    advisory: z.enum(["NONE", "WATCH", "WARNING"]),
    tropical_night_streak: z.number().int().min(0).max(366),
    is_partial: z.boolean(),
    is_stale: z.boolean(),
    error_code: z.string().nullable(),
    observed_at: TimestampSchema,
    collected_at: TimestampSchema,
    expires_at: TimestampSchema,
  })
  .strict();

export type WeatherLocation = z.infer<typeof WeatherLocationSchema>;
export type PersistedWeatherSnapshot = z.infer<typeof PersistedWeatherSnapshotSchema>;

export type WeatherSnapshotUpsertDto = Readonly<{
  location_key: string;
  source: WeatherCandidate["source"];
  location: string;
  kma_nx: number;
  kma_ny: number;
  temperature_c: number;
  humidity_pct: number;
  feels_like_c: number;
  advisory: HeatAdvisory;
  tropical_night_streak: number;
  is_partial: boolean;
  is_stale: boolean;
  error_code: string | null;
  observed_at: string;
  collected_at: string;
  expires_at: string;
}>;

export type WeatherRepository = Readonly<{
  findLatestValidSnapshot(input: {
    locationKeys: readonly [string, string];
    beforeOrAt: string;
  }): Promise<PersistedWeatherSnapshot | null>;
  listTropicalNightSummaries(input: {
    apiHubLocationKey: string;
    throughMorningDate: string;
  }): Promise<readonly TropicalNightSummary[]>;
  upsertWeatherSnapshot(row: WeatherSnapshotUpsertDto): Promise<Readonly<{ id: number }>>;
}>;

export type WeatherServiceLogEvent = Readonly<{
  event: "weather_provider_failed" | "weather_dependency_failed";
  stage: "PRIMARY" | "FALLBACK" | "WARNING" | "CACHE" | "TROPICAL_NIGHT" | "PERSISTENCE";
  code: string;
}>;

export type WeatherServiceLogger = (event: WeatherServiceLogEvent) => void;

export interface WeatherServiceResult {
  selection: WeatherSelection;
  weatherSnapshotId: number;
}

export class WeatherPersistenceError extends Error {
  readonly code = "WEATHER_SNAPSHOT_PERSIST_FAILED";

  constructor() {
    super("WEATHER_SNAPSHOT_PERSIST_FAILED");
    this.name = "WeatherPersistenceError";
  }
}

type WeatherClock = Readonly<{ now(): Date }>;

type WeatherServiceDependencies = Readonly<{
  kmaClient: KmaClient;
  repository: WeatherRepository;
  clock: WeatherClock;
  logger?: WeatherServiceLogger;
}>;

const SAFE_PROVIDER_CODE = /^KMA_(?:APIHUB|VILLAGE)_(?:HTTP_\d{3}|TIMEOUT|INVALID_RESPONSE)$/;

function toKstIso(timestamp: number, milliseconds: boolean): string {
  const shifted = new Date(timestamp + 9 * 60 * 60_000).toISOString();
  return `${shifted.slice(0, milliseconds ? 23 : 19)}+09:00`;
}

function safeProviderCode(
  error: unknown,
  fallback: "KMA_PRIMARY_FAILED" | "KMA_FALLBACK_FAILED" | "KMA_WARNING_FAILED",
): string {
  if (error instanceof KmaProviderError && SAFE_PROVIDER_CODE.test(error.code)) {
    return error.code;
  }
  return fallback;
}

function log(logger: WeatherServiceLogger | undefined, event: WeatherServiceLogEvent): void {
  try {
    logger?.(event);
  } catch {
    // Observability must never alter the weather fail-safe path.
  }
}

export function buildWeatherLocationKeys(input: WeatherLocation): {
  apiHub: string;
  village: string;
} {
  const location = WeatherLocationSchema.parse(input);
  return {
    apiHub: `apihub:${location.apiHubCellId}`,
    village: `village:${location.kmaGrid.nx}:${location.kmaGrid.ny}`,
  };
}

export function selectActiveDaeguHeatWarning(
  warnings: readonly KmaHeatWarning[],
  at: string,
): KmaHeatWarning | null {
  const timestamp = Date.parse(TimestampSchema.parse(at));

  return (
    warnings
      .filter(
        (warning) =>
          warning.kind === "HEAT" &&
          warning.regionName.includes("대구") &&
          Date.parse(warning.issuedAt) <= timestamp &&
          Date.parse(warning.effectiveAt) <= timestamp,
      )
      .sort((left, right) => {
        const levelDifference =
          Number(right.level === "WARNING") - Number(left.level === "WARNING");
        return (
          levelDifference ||
          Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt) ||
          Date.parse(right.issuedAt) - Date.parse(left.issuedAt)
        );
      })[0] ?? null
  );
}

function latestCompletePastObservation(
  observations: readonly Kma500mPointObservation[],
  now: number,
): Kma500mPointObservation | null {
  return (
    observations
      .filter(
        (observation) =>
          Date.parse(observation.observedAt) <= now &&
          observation.apparentTemperatureC !== null &&
          observation.airTemperatureC !== null &&
          observation.relativeHumidityPct !== null,
      )
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0] ?? null
  );
}

function latestPastForecast(
  forecasts: readonly VilageForecastSlot[],
  now: number,
): VilageForecastSlot | null {
  return (
    forecasts
      .filter((forecast) => Date.parse(forecast.forecastAt) <= now)
      .sort((left, right) => Date.parse(right.forecastAt) - Date.parse(left.forecastAt))[0] ?? null
  );
}

function snapshotCandidate(snapshot: PersistedWeatherSnapshot | null): WeatherCandidate | null {
  if (!snapshot) return null;
  return {
    source: snapshot.source,
    observedAt: snapshot.observed_at,
    airTemperatureC: snapshot.temperature_c,
    relativeHumidityPct: snapshot.humidity_pct,
    feelsLikeC: snapshot.feels_like_c,
    advisory: snapshot.advisory,
    tropicalNightStreak: snapshot.tropical_night_streak,
    tropicalNightPartial: snapshot.is_partial,
  };
}

function snapshotDto(input: {
  location: WeatherLocation;
  keys: ReturnType<typeof buildWeatherLocationKeys>;
  selection: WeatherSelection;
  collectedAt: string;
}): WeatherSnapshotUpsertDto {
  const { reading } = input.selection;
  const locationKey = reading.source === "KMA_APIHUB_500M" ? input.keys.apiHub : input.keys.village;

  return {
    location_key: locationKey,
    source: reading.source,
    location: `SRID=4326;POINT(${String(input.location.longitude)} ${String(input.location.latitude)})`,
    kma_nx: input.location.kmaGrid.nx,
    kma_ny: input.location.kmaGrid.ny,
    temperature_c: reading.airTemperatureC,
    humidity_pct: reading.relativeHumidityPct,
    feels_like_c: reading.feelsLikeC,
    advisory: reading.advisory,
    tropical_night_streak: reading.tropicalNightStreak,
    is_partial: input.selection.state === "partial",
    is_stale: input.selection.isStale,
    error_code: input.selection.errorCode,
    observed_at: reading.observedAt,
    collected_at: input.collectedAt,
    expires_at: input.selection.expiresAt,
  };
}

async function readLatestSnapshot(
  repository: WeatherRepository,
  locationKeys: readonly [string, string],
  nowIso: string,
  logger: WeatherServiceLogger | undefined,
): Promise<PersistedWeatherSnapshot | null> {
  try {
    const value = await repository.findLatestValidSnapshot({
      locationKeys,
      beforeOrAt: nowIso,
    });
    if (!value) return null;
    const parsed = PersistedWeatherSnapshotSchema.parse(value);
    if (
      !locationKeys.includes(parsed.location_key) ||
      Date.parse(parsed.observed_at) > Date.parse(nowIso)
    ) {
      throw new Error("invalid cache scope");
    }
    return parsed;
  } catch {
    log(logger, {
      event: "weather_dependency_failed",
      stage: "CACHE",
      code: "WEATHER_CACHE_READ_FAILED",
    });
    return null;
  }
}

async function readTropicalNightContext(input: {
  repository: WeatherRepository;
  apiHubLocationKey: string;
  throughMorningDate: string;
  previous: PersistedWeatherSnapshot | null;
  logger: WeatherServiceLogger | undefined;
}): Promise<{ streak: number; isPartial: boolean }> {
  try {
    const summaries = await input.repository.listTropicalNightSummaries({
      apiHubLocationKey: input.apiHubLocationKey,
      throughMorningDate: input.throughMorningDate,
    });
    return calculateTropicalNightStreak(input.throughMorningDate, summaries);
  } catch {
    log(input.logger, {
      event: "weather_dependency_failed",
      stage: "TROPICAL_NIGHT",
      code: "TROPICAL_NIGHT_READ_FAILED",
    });
    return {
      streak: input.previous?.tropical_night_streak ?? 0,
      isPartial: true,
    };
  }
}

export function createWeatherService(dependencies: WeatherServiceDependencies): {
  resolve(location: WeatherLocation): Promise<WeatherServiceResult>;
} {
  return {
    async resolve(locationInput) {
      const location = WeatherLocationSchema.parse(locationInput);
      const now = dependencies.clock.now();
      const nowMs = now.getTime();
      if (!Number.isFinite(nowMs)) throw new Error("WEATHER_CLOCK_INVALID");

      const nowIso = toKstIso(nowMs, false);
      const morningDate = nowIso.slice(0, 10);
      const keys = buildWeatherLocationKeys(location);
      const locationKeys = [keys.apiHub, keys.village] as const;
      const previous = await readLatestSnapshot(
        dependencies.repository,
        locationKeys,
        nowIso,
        dependencies.logger,
      );
      const tropicalNight = await readTropicalNightContext({
        repository: dependencies.repository,
        apiHubLocationKey: keys.apiHub,
        throughMorningDate: morningDate,
        previous,
        logger: dependencies.logger,
      });

      let advisory: HeatAdvisory = "NONE";
      let warningUnavailable = false;
      try {
        const warnings = await dependencies.kmaClient.getCurrentHeatWarnings(nowIso);
        advisory = selectActiveDaeguHeatWarning(warnings, nowIso)?.level ?? "NONE";
      } catch (error) {
        warningUnavailable = true;
        advisory = previous?.advisory ?? "NONE";
        log(dependencies.logger, {
          event: "weather_provider_failed",
          stage: "WARNING",
          code: safeProviderCode(error, "KMA_WARNING_FAILED"),
        });
      }

      let primary: WeatherCandidate | null = null;
      try {
        const observations = await dependencies.kmaClient.getPointObservations({
          longitude: location.longitude,
          latitude: location.latitude,
          at: nowIso,
        });
        const observation = latestCompletePastObservation(observations, nowMs);
        if (!observation) throw new Error("no complete past observation");

        primary = {
          source: "KMA_APIHUB_500M",
          observedAt: observation.observedAt,
          airTemperatureC: observation.airTemperatureC!,
          relativeHumidityPct: observation.relativeHumidityPct!,
          feelsLikeC: observation.apparentTemperatureC!,
          advisory,
          tropicalNightStreak: tropicalNight.streak,
          tropicalNightPartial: tropicalNight.isPartial,
        };
      } catch (error) {
        log(dependencies.logger, {
          event: "weather_provider_failed",
          stage: "PRIMARY",
          code: safeProviderCode(error, "KMA_PRIMARY_FAILED"),
        });
      }

      let fallback: WeatherCandidate | null = null;
      if (!primary) {
        try {
          const forecasts = await dependencies.kmaClient.getVillageForecast({
            nx: location.kmaGrid.nx,
            ny: location.kmaGrid.ny,
            at: nowIso,
          });
          const forecast = latestPastForecast(forecasts, nowMs);
          if (!forecast) throw new Error("no past forecast slot");

          fallback = createVillageFallbackCandidate({
            forecastAt: forecast.forecastAt,
            airTemperatureC: forecast.airTemperatureC,
            relativeHumidityPct: forecast.relativeHumidityPct,
            advisory,
            tropicalNightStreak: tropicalNight.streak,
            tropicalNightPartial: tropicalNight.isPartial,
          });
        } catch (error) {
          log(dependencies.logger, {
            event: "weather_provider_failed",
            stage: "FALLBACK",
            code: safeProviderCode(error, "KMA_FALLBACK_FAILED"),
          });
        }
      }

      const previousCandidate = snapshotCandidate(previous);
      const selection = selectRiskWeather({
        now: nowIso,
        primary,
        primaryErrorCode: warningUnavailable ? "KMA_WARNING_UNAVAILABLE" : null,
        fallback,
        cached: previousCandidate,
        lastValid: previousCandidate,
      });

      if (!selection.shouldPersistWeatherSnapshot) {
        return {
          selection,
          weatherSnapshotId: previous!.id,
        };
      }

      const dto = snapshotDto({
        location,
        keys,
        selection,
        collectedAt: nowIso,
      });
      try {
        const saved = await dependencies.repository.upsertWeatherSnapshot(dto);
        return { selection, weatherSnapshotId: saved.id };
      } catch {
        log(dependencies.logger, {
          event: "weather_dependency_failed",
          stage: "PERSISTENCE",
          code: "WEATHER_SNAPSHOT_PERSIST_FAILED",
        });
        throw new WeatherPersistenceError();
      }
    },
  };
}
