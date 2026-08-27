import "@tanstack/react-start/server-only";

import type { KmaClient } from "@/integrations/kma/kma.server";
import {
  DAEGU_WEATHER_LOCATION,
  summerApparentTemperatureC,
  type Kma500mPointObservation,
  type KmaHeatWarning,
  type VilageForecastSlot,
} from "@/integrations/kma/weather";
import type { HeatAdvisory } from "@/lib/domain-types";

type Availability = "AVAILABLE" | "UNAVAILABLE";

const MAX_PUBLIC_WEATHER_DISTANCE_MS = 3 * 60 * 60_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 4_000;

export interface PublicHomeWeather {
  readonly source: "KMA_APIHUB_500M" | "KMA_VILLAGE_FCST";
  readonly observedAt: string;
  readonly feelsLikeC: number;
  readonly airTemperatureC: number;
  readonly relativeHumidityPct: number;
}

export interface LiveHomeSummary {
  readonly fetchedAt: string;
  readonly weather: PublicHomeWeather | null;
  readonly heatAdvisory: HeatAdvisory | null;
  readonly shelterCount: number | null;
  readonly availability: Readonly<{
    weather: Availability;
    heatAdvisory: Availability;
    shelters: Availability;
  }>;
}

export interface LiveHomeSummaryDependencies {
  readonly kmaClient: KmaClient;
  readonly countShelters: () => Promise<number>;
  readonly now: () => Date;
  readonly operationTimeoutMs?: number;
}

export function unavailableLiveHomeSummary(at: Date = new Date()): LiveHomeSummary {
  return Object.freeze({
    fetchedAt: at.toISOString(),
    weather: null,
    heatAdvisory: null,
    shelterCount: null,
    availability: Object.freeze({
      weather: "UNAVAILABLE",
      heatAdvisory: "UNAVAILABLE",
      shelters: "UNAVAILABLE",
    }),
  });
}

function newestCompleteObservation(
  rows: readonly Kma500mPointObservation[],
  nowMs: number,
): PublicHomeWeather | null {
  const row = [...rows]
    .filter(
      (candidate) =>
        candidate.apparentTemperatureC !== null &&
        candidate.airTemperatureC !== null &&
        candidate.relativeHumidityPct !== null &&
        Number.isFinite(Date.parse(candidate.observedAt)) &&
        Date.parse(candidate.observedAt) <= nowMs &&
        nowMs - Date.parse(candidate.observedAt) <= MAX_PUBLIC_WEATHER_DISTANCE_MS,
    )
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];

  if (
    !row ||
    row.apparentTemperatureC === null ||
    row.airTemperatureC === null ||
    row.relativeHumidityPct === null
  ) {
    return null;
  }

  return Object.freeze({
    source: "KMA_APIHUB_500M",
    observedAt: row.observedAt,
    feelsLikeC: row.apparentTemperatureC,
    airTemperatureC: row.airTemperatureC,
    relativeHumidityPct: row.relativeHumidityPct,
  });
}

function nearestForecast(
  rows: readonly VilageForecastSlot[],
  nowMs: number,
): PublicHomeWeather | null {
  const row = [...rows]
    .filter((candidate) => {
      const forecastMs = Date.parse(candidate.forecastAt);
      return (
        Number.isFinite(forecastMs) &&
        Math.abs(forecastMs - nowMs) <= MAX_PUBLIC_WEATHER_DISTANCE_MS
      );
    })
    .sort((left, right) => {
      const distance = Math.abs(Date.parse(left.forecastAt) - nowMs);
      const otherDistance = Math.abs(Date.parse(right.forecastAt) - nowMs);
      return distance - otherDistance || left.forecastAt.localeCompare(right.forecastAt);
    })[0];

  if (!row) return null;

  return Object.freeze({
    source: "KMA_VILLAGE_FCST",
    observedAt: row.forecastAt,
    feelsLikeC: summerApparentTemperatureC(row.airTemperatureC, row.relativeHumidityPct),
    airTemperatureC: row.airTemperatureC,
    relativeHumidityPct: row.relativeHumidityPct,
  });
}

function isDaeguWarningRegion(regionName: string): boolean {
  const name = regionName.trim();
  return (
    name === "대구" ||
    name.startsWith("대구광역시") ||
    name.startsWith("대구 ") ||
    name.startsWith("대구(")
  );
}

function currentAdvisory(rows: readonly KmaHeatWarning[], nowMs: number): HeatAdvisory {
  const active = rows.filter(
    (warning) =>
      isDaeguWarningRegion(warning.regionName) && Date.parse(warning.effectiveAt) <= nowMs,
  );
  if (active.some((warning) => warning.level === "WARNING")) return "WARNING";
  if (active.some((warning) => warning.level === "WATCH")) return "WATCH";
  return "NONE";
}

async function fallbackWeather(
  client: KmaClient,
  at: string,
  nowMs: number,
  operationTimeoutMs: number,
): Promise<PublicHomeWeather | null> {
  try {
    const slots = await runWithin(
      () =>
        client.getVillageForecast({
          ...DAEGU_WEATHER_LOCATION.shortForecastGrid,
          at,
        }),
      operationTimeoutMs,
    );
    return nearestForecast(slots, nowMs);
  } catch {
    return null;
  }
}

async function runWithin<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("HOME_LIVE_SOURCE_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function loadLiveHomeSummary(
  dependencies: LiveHomeSummaryDependencies,
): Promise<LiveHomeSummary> {
  const now = dependencies.now();
  const nowMs = now.getTime();
  const at = now.toISOString();
  const operationTimeoutMs = dependencies.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;

  const [pointResult, warningResult, shelterResult] = await Promise.allSettled([
    runWithin(
      () =>
        dependencies.kmaClient.getPointObservations({
          longitude: DAEGU_WEATHER_LOCATION.longitude,
          latitude: DAEGU_WEATHER_LOCATION.latitude,
          at,
        }),
      operationTimeoutMs,
    ),
    runWithin(() => dependencies.kmaClient.getCurrentHeatWarnings(at), operationTimeoutMs),
    runWithin(dependencies.countShelters, operationTimeoutMs),
  ]);

  const primary =
    pointResult.status === "fulfilled" ? newestCompleteObservation(pointResult.value, nowMs) : null;
  const weather =
    primary ?? (await fallbackWeather(dependencies.kmaClient, at, nowMs, operationTimeoutMs));
  const heatAdvisory =
    warningResult.status === "fulfilled" ? currentAdvisory(warningResult.value, nowMs) : null;
  const shelterCount =
    shelterResult.status === "fulfilled" &&
    Number.isInteger(shelterResult.value) &&
    shelterResult.value >= 0
      ? shelterResult.value
      : null;

  return Object.freeze({
    fetchedAt: now.toISOString(),
    weather,
    heatAdvisory,
    shelterCount,
    availability: Object.freeze({
      weather: weather === null ? "UNAVAILABLE" : "AVAILABLE",
      heatAdvisory: heatAdvisory === null ? "UNAVAILABLE" : "AVAILABLE",
      shelters: shelterCount === null ? "UNAVAILABLE" : "AVAILABLE",
    }),
  });
}

export async function loadProductionLiveHomeSummary(): Promise<LiveHomeSummary> {
  const [{ createDefaultKmaClient }, { createAdminSupabaseClient }] = await Promise.all([
    import("@/integrations/kma/kma.server"),
    import("@/lib/supabase/admin.server"),
  ]);
  const client = createAdminSupabaseClient();

  return loadLiveHomeSummary({
    kmaClient: createDefaultKmaClient(),
    countShelters: async () => {
      const response = await client.from("shelters").select("id", {
        count: "exact",
        head: true,
      });
      if (response.error !== null || response.count === null) {
        throw new Error("SHELTER_COUNT_UNAVAILABLE");
      }
      return response.count;
    },
    now: () => new Date(),
  });
}
