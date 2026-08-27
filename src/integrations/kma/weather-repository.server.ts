import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { summarizeTropicalNight } from "./tropical-night";
import type {
  PersistedWeatherSnapshot,
  WeatherRepository,
  WeatherSnapshotUpsertDto,
} from "./weather-service.server";

const OffsetTimestampSchema = z.string().datetime({ offset: true });
const LocationKeySchema = z.string().min(1).max(160);
const KstDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day!));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month! - 1 &&
      parsed.getUTCDate() === day
    );
  });

const PersistedSnapshotRowSchema = z
  .object({
    id: z.number().int().positive(),
    location_key: LocationKeySchema,
    source: z.enum(["KMA_APIHUB_500M", "KMA_VILLAGE_FCST"]),
    temperature_c: z.number().finite().min(-80).max(80),
    humidity_pct: z.number().finite().min(0).max(100),
    feels_like_c: z.number().finite().min(-80).max(80),
    advisory: z.enum(["NONE", "WATCH", "WARNING"]),
    tropical_night_streak: z.number().int().min(0).max(366),
    is_partial: z.boolean(),
    is_stale: z.boolean(),
    error_code: z.string().nullable(),
    observed_at: OffsetTimestampSchema,
    collected_at: OffsetTimestampSchema,
    expires_at: OffsetTimestampSchema,
  })
  .strict();

const TemperatureRowSchema = z
  .object({
    observed_at: OffsetTimestampSchema,
    collected_at: OffsetTimestampSchema,
    temperature_c: z.number().finite().min(-80).max(80),
  })
  .strict();

const SnapshotIdentitySchema = z.object({ id: z.number().int().positive() }).strict();

const SnapshotUpsertSchema = z
  .object({
    location_key: LocationKeySchema,
    source: z.enum(["KMA_APIHUB_500M", "KMA_VILLAGE_FCST"]),
    location: z.string().regex(/^SRID=4326;POINT\(-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?\)$/),
    kma_nx: z.number().int().positive(),
    kma_ny: z.number().int().positive(),
    temperature_c: z.number().finite().min(-80).max(80),
    humidity_pct: z.number().finite().min(0).max(100),
    feels_like_c: z.number().finite().min(-80).max(80),
    advisory: z.enum(["NONE", "WATCH", "WARNING"]),
    tropical_night_streak: z.number().int().min(0).max(366),
    is_partial: z.boolean(),
    is_stale: z.boolean(),
    error_code: z.string().nullable(),
    observed_at: OffsetTimestampSchema,
    collected_at: OffsetTimestampSchema,
    expires_at: OffsetTimestampSchema,
  })
  .strict();

type QueryResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string }> | null;
}>;

export class WeatherRepositoryError extends Error {
  constructor(
    readonly code: "WEATHER_REPOSITORY_QUERY_FAILED" | "WEATHER_REPOSITORY_INVALID_RESPONSE",
  ) {
    super(code);
    this.name = "WeatherRepositoryError";
  }
}

function assertQuerySucceeded(result: QueryResult): unknown {
  if (result.error) {
    throw new WeatherRepositoryError("WEATHER_REPOSITORY_QUERY_FAILED");
  }
  return result.data;
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new WeatherRepositoryError("WEATHER_REPOSITORY_INVALID_RESPONSE");
  }
  return parsed.data;
}

function shiftKstDate(date: string, days: number): string {
  const validDate = KstDateSchema.parse(date);
  return new Date(Date.parse(`${validDate}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function tropicalNightDates(throughMorningDate: string): readonly string[] {
  const through = KstDateSchema.parse(throughMorningDate);
  return Array.from({ length: 367 }, (_, index) => shiftKstDate(through, index - 366));
}

function tropicalNightRange(throughMorningDate: string): {
  start: string;
  end: string;
} {
  const earliestMorning = shiftKstDate(throughMorningDate, -366);
  const previousEvening = shiftKstDate(earliestMorning, -1);
  return {
    start: `${previousEvening}T18:01:00+09:00`,
    end: `${KstDateSchema.parse(throughMorningDate)}T09:00:00+09:00`,
  };
}

/** Trusted-server adapter. The service-role client must never be returned to a route payload. */
export function createWeatherRepository(client: SupabaseClient): WeatherRepository {
  return {
    async findLatestValidSnapshot(input): Promise<PersistedWeatherSnapshot | null> {
      const locationKeys = z
        .tuple([LocationKeySchema, LocationKeySchema])
        .parse(input.locationKeys);
      const beforeOrAt = OffsetTimestampSchema.parse(input.beforeOrAt);
      const result = (await client
        .from("weather_snapshots")
        .select(
          "id,location_key,source,temperature_c,humidity_pct,feels_like_c,advisory,tropical_night_streak,is_partial,is_stale,error_code,observed_at,collected_at,expires_at",
        )
        .in("location_key", locationKeys)
        .lte("observed_at", beforeOrAt)
        .order("observed_at", { ascending: false })
        .order("collected_at", { ascending: false })
        .limit(1)
        .maybeSingle()) as QueryResult;

      const data = assertQuerySucceeded(result);
      return data === null ? null : parseOrThrow(PersistedSnapshotRowSchema, data);
    },

    async listTropicalNightSummaries(input) {
      const apiHubLocationKey = LocationKeySchema.refine((value) =>
        value.startsWith("apihub:"),
      ).parse(input.apiHubLocationKey);
      const dates = tropicalNightDates(input.throughMorningDate);
      const range = tropicalNightRange(input.throughMorningDate);
      const result = (await client
        .from("weather_snapshots")
        .select("observed_at,collected_at,temperature_c")
        .eq("location_key", apiHubLocationKey)
        .eq("source", "KMA_APIHUB_500M")
        .gte("observed_at", range.start)
        .lte("observed_at", range.end)
        .order("observed_at", { ascending: true })
        .order("collected_at", { ascending: false })) as QueryResult;

      const rows = parseOrThrow(z.array(TemperatureRowSchema), assertQuerySucceeded(result));
      const latestRevisionByObservation = new Map<string, z.infer<typeof TemperatureRowSchema>>();
      for (const row of rows) {
        const current = latestRevisionByObservation.get(row.observed_at);
        if (!current || Date.parse(row.collected_at) > Date.parse(current.collected_at)) {
          latestRevisionByObservation.set(row.observed_at, row);
        }
      }
      const observations = [...latestRevisionByObservation.values()]
        .sort((left, right) => Date.parse(left.observed_at) - Date.parse(right.observed_at))
        .map((row) => ({
          observedAt: row.observed_at,
          temperatureC: row.temperature_c,
        }));
      return dates.map((morningDate) => summarizeTropicalNight(morningDate, observations));
    },

    async upsertWeatherSnapshot(row: WeatherSnapshotUpsertDto) {
      const dto = parseOrThrow(SnapshotUpsertSchema, row);
      const insertResult = (await client
        .from("weather_snapshots")
        .insert(dto)
        .select("id")
        .single()) as QueryResult;

      if (!insertResult.error) {
        return parseOrThrow(SnapshotIdentitySchema, insertResult.data);
      }
      if (insertResult.error.code !== "23505") {
        throw new WeatherRepositoryError("WEATHER_REPOSITORY_QUERY_FAILED");
      }

      const exactCollectionResult = (await client
        .from("weather_snapshots")
        .select("id")
        .eq("location_key", dto.location_key)
        .eq("source", dto.source)
        .eq("observed_at", dto.observed_at)
        .eq("collected_at", dto.collected_at)
        .maybeSingle()) as QueryResult;
      const exactCollection = assertQuerySucceeded(exactCollectionResult);
      if (exactCollection !== null) {
        return parseOrThrow(SnapshotIdentitySchema, exactCollection);
      }

      // During the compatibility rollout the legacy three-column constraint may still
      // reject a later collection of the same observation. Reuse that identity until
      // the append-only four-column constraint is installed, without relying on either
      // constraint as an ON CONFLICT target.
      const legacyObservationResult = (await client
        .from("weather_snapshots")
        .select("id")
        .eq("location_key", dto.location_key)
        .eq("source", dto.source)
        .eq("observed_at", dto.observed_at)
        .order("collected_at", { ascending: false })
        .limit(1)
        .maybeSingle()) as QueryResult;
      const legacyObservation = assertQuerySucceeded(legacyObservationResult);
      if (legacyObservation === null) {
        throw new WeatherRepositoryError("WEATHER_REPOSITORY_INVALID_RESPONSE");
      }
      return parseOrThrow(SnapshotIdentitySchema, legacyObservation);
    },
  };
}
