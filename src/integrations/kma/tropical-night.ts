import { z } from "zod";

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
  }, "Invalid KST calendar date");

const TemperatureObservationSchema = z.object({
  observedAt: z.string().datetime({ offset: true }),
  temperatureC: z.number().finite().min(-80).max(80),
});

export type TemperatureObservation = z.infer<typeof TemperatureObservationSchema>;

export interface TropicalNightSummary {
  morningDate: string;
  minimumTemperatureC: number | null;
  isTropicalNight: boolean | null;
  isComplete: boolean;
}

const DEFAULT_MAX_GAP_MS = 90 * 60_000;
const NIGHT_START_OFFSET_MS = -(5 * 60 + 59) * 60_000;
const NIGHT_END_OFFSET_MS = 9 * 60 * 60_000;

function kstMorningStart(morningDate: string): number {
  return Date.parse(`${KstDateSchema.parse(morningDate)}T00:00:00+09:00`);
}

function previousKstDate(date: string): string {
  const [year, month, day] = KstDateSchema.parse(date).split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! - 1)).toISOString().slice(0, 10);
}

/**
 * Summarizes the official KMA tropical-night window: 18:01 on the previous
 * KST date through 09:00 on the morning date. Sparse input is partial and must
 * never be interpreted as a non-tropical night.
 */
export function summarizeTropicalNight(
  morningDate: string,
  observations: readonly TemperatureObservation[],
  maxGapMs = DEFAULT_MAX_GAP_MS,
): TropicalNightSummary {
  if (!Number.isFinite(maxGapMs) || maxGapMs <= 0) {
    throw new Error("maxGapMs must be a positive finite duration");
  }

  const midnight = kstMorningStart(morningDate);
  const windowStart = midnight + NIGHT_START_OFFSET_MS;
  const windowEnd = midnight + NIGHT_END_OFFSET_MS;
  const readings = observations
    .map((input) => TemperatureObservationSchema.parse(input))
    .map((observation) => ({ ...observation, timestamp: Date.parse(observation.observedAt) }))
    .filter(({ timestamp }) => timestamp >= windowStart && timestamp <= windowEnd)
    .sort((left, right) => left.timestamp - right.timestamp);

  const minimumTemperatureC = readings.length
    ? Math.min(...readings.map(({ temperatureC }) => temperatureC))
    : null;
  const first = readings[0]?.timestamp;
  const last = readings.at(-1)?.timestamp;
  const boundaryCoverage =
    first !== undefined &&
    last !== undefined &&
    first - windowStart <= maxGapMs &&
    windowEnd - last <= maxGapMs;
  const gapsAreCovered = readings.every((reading, index) => {
    const next = readings[index + 1];
    return next === undefined || next.timestamp - reading.timestamp <= maxGapMs;
  });
  const isComplete = boundaryCoverage && gapsAreCovered;

  return {
    morningDate,
    minimumTemperatureC,
    isTropicalNight: isComplete && minimumTemperatureC !== null ? minimumTemperatureC >= 25 : null,
    isComplete,
  };
}

export function calculateTropicalNightStreak(
  throughMorningDate: string,
  summaries: readonly TropicalNightSummary[],
): { streak: number; isPartial: boolean } {
  const byDate = new Map(summaries.map((summary) => [summary.morningDate, summary]));
  let currentDate = KstDateSchema.parse(throughMorningDate);
  let streak = 0;

  for (let inspected = 0; inspected <= 366; inspected += 1) {
    const summary = byDate.get(currentDate);
    if (!summary || !summary.isComplete || summary.isTropicalNight === null) {
      return { streak, isPartial: true };
    }
    if (!summary.isTropicalNight) {
      return { streak, isPartial: false };
    }

    streak += 1;
    currentDate = previousKstDate(currentDate);
  }

  return { streak, isPartial: true };
}
