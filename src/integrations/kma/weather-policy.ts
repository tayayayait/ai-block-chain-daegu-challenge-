import { z } from "zod";
import { HEAT_ADVISORIES } from "@/lib/domain-types";
import { summerApparentTemperatureC } from "./weather";

const TimestampSchema = z.string().datetime({ offset: true });
const WeatherCandidateSchema = z
  .object({
    source: z.enum(["KMA_APIHUB_500M", "KMA_VILLAGE_FCST"]),
    observedAt: TimestampSchema,
    airTemperatureC: z.number().finite().min(-80).max(80),
    relativeHumidityPct: z.number().finite().min(0).max(100),
    feelsLikeC: z.number().finite().min(-80).max(80),
    advisory: z.enum(HEAT_ADVISORIES),
    tropicalNightStreak: z.number().int().min(0).max(366),
    tropicalNightPartial: z.boolean(),
  })
  .strict();

export type WeatherCandidate = z.infer<typeof WeatherCandidateSchema>;

export type WeatherSelectionMode = "PRIMARY" | "FALLBACK" | "CACHE" | "LAST_VALID";
export type WeatherSelectionState = "success" | "partial";
export type WeatherSelectionErrorCode =
  | "KMA_PRIMARY_UNAVAILABLE"
  | "KMA_UPSTREAM_UNAVAILABLE"
  | "KMA_WARNING_UNAVAILABLE"
  | "KMA_TROPICAL_NIGHT_PARTIAL";

export interface WeatherSelection {
  mode: WeatherSelectionMode;
  state: WeatherSelectionState;
  reading: WeatherCandidate;
  isStale: boolean;
  errorCode: WeatherSelectionErrorCode | null;
  expiresAt: string;
  shouldPersistWeatherSnapshot: boolean;
}

export class WeatherUnavailableError extends Error {
  readonly code = "WEATHER_UNAVAILABLE";

  constructor() {
    super("No valid weather input is available; risk recomputation must be skipped");
    this.name = "WeatherUnavailableError";
  }
}

const CACHE_TTL_MS = 25 * 60_000;
const RECENT_CACHE_MAX_AGE_MS = 3 * 60 * 60_000;
const LAST_VALID_MAX_AGE_MS = 24 * 60 * 60_000;

function toKstIso(timestamp: number): string {
  return new Date(timestamp + 9 * 60 * 60_000).toISOString().replace("Z", "+09:00");
}

function selection(
  nowMs: number,
  readingInput: WeatherCandidate,
  mode: WeatherSelectionMode,
  options: {
    isStale: boolean;
    errorCode: WeatherSelectionErrorCode | null;
    shouldPersistWeatherSnapshot: boolean;
  },
): WeatherSelection {
  const reading = WeatherCandidateSchema.parse(readingInput);
  const tropicalNightPartial = reading.tropicalNightPartial;

  return {
    mode,
    state:
      mode === "PRIMARY" && !tropicalNightPartial && options.errorCode === null
        ? "success"
        : "partial",
    reading,
    isStale: options.isStale,
    errorCode: options.errorCode ?? (tropicalNightPartial ? "KMA_TROPICAL_NIGHT_PARTIAL" : null),
    expiresAt: toKstIso(nowMs + CACHE_TTL_MS),
    shouldPersistWeatherSnapshot: options.shouldPersistWeatherSnapshot,
  };
}

export function createVillageFallbackCandidate(input: {
  forecastAt: string;
  airTemperatureC: number;
  relativeHumidityPct: number;
  advisory: WeatherCandidate["advisory"];
  tropicalNightStreak: number;
  tropicalNightPartial: boolean;
}): WeatherCandidate {
  return WeatherCandidateSchema.parse({
    source: "KMA_VILLAGE_FCST",
    observedAt: input.forecastAt,
    airTemperatureC: input.airTemperatureC,
    relativeHumidityPct: input.relativeHumidityPct,
    feelsLikeC: summerApparentTemperatureC(input.airTemperatureC, input.relativeHumidityPct),
    advisory: input.advisory,
    tropicalNightStreak: input.tropicalNightStreak,
    tropicalNightPartial: input.tropicalNightPartial,
  });
}

export function selectRiskWeather(input: {
  now: string;
  primary?: WeatherCandidate | null;
  primaryErrorCode?: Extract<WeatherSelectionErrorCode, "KMA_WARNING_UNAVAILABLE"> | null;
  fallback?: WeatherCandidate | null;
  cached?: WeatherCandidate | null;
  lastValid?: WeatherCandidate | null;
}): WeatherSelection {
  const now = Date.parse(TimestampSchema.parse(input.now));

  if (input.primary) {
    return selection(now, input.primary, "PRIMARY", {
      isStale: false,
      errorCode: input.primaryErrorCode ?? null,
      shouldPersistWeatherSnapshot: true,
    });
  }

  if (input.fallback) {
    return selection(now, input.fallback, "FALLBACK", {
      isStale: false,
      errorCode: "KMA_PRIMARY_UNAVAILABLE",
      shouldPersistWeatherSnapshot: true,
    });
  }

  if (input.cached) {
    const cached = WeatherCandidateSchema.parse(input.cached);
    const cacheAge = now - Date.parse(cached.observedAt);
    if (cacheAge >= 0 && cacheAge <= RECENT_CACHE_MAX_AGE_MS) {
      return selection(now, cached, "CACHE", {
        isStale: true,
        errorCode: "KMA_UPSTREAM_UNAVAILABLE",
        shouldPersistWeatherSnapshot: true,
      });
    }
  }

  if (input.lastValid) {
    const lastValid = WeatherCandidateSchema.parse(input.lastValid);
    const lastValidAge = now - Date.parse(lastValid.observedAt);
    if (lastValidAge >= 0 && lastValidAge <= LAST_VALID_MAX_AGE_MS) {
      return selection(now, lastValid, "LAST_VALID", {
        isStale: true,
        errorCode: "KMA_UPSTREAM_UNAVAILABLE",
        shouldPersistWeatherSnapshot: true,
      });
    }
  }

  throw new WeatherUnavailableError();
}
