export const DEPARTURE_OFFSETS_MINUTES = [0, 30, 60] as const;

export type DepartureOffsetMinutes = (typeof DEPARTURE_OFFSETS_MINUTES)[number];

export interface DepartureSlot {
  readonly offsetMinutes: DepartureOffsetMinutes;
  readonly label: "지금 출발" | "30분 후" | "1시간 후";
  readonly departureAt: string;
}

export interface DepartureOptionMetrics {
  readonly offsetMinutes: DepartureOffsetMinutes;
  readonly feelsLikeC: number | null;
  readonly directSunMinutes: number | null;
  readonly durationMinutes: number;
}

const LABEL_BY_OFFSET: Readonly<Record<DepartureOffsetMinutes, DepartureSlot["label"]>> = {
  0: "지금 출발",
  30: "30분 후",
  60: "1시간 후",
};

export function buildDepartureSlots(baseTime: Date): readonly DepartureSlot[] {
  const timestamp = baseTime.getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError("baseTime must be a valid Date");

  return DEPARTURE_OFFSETS_MINUTES.map((offsetMinutes) => ({
    offsetMinutes,
    label: LABEL_BY_OFFSET[offsetMinutes],
    departureAt: new Date(timestamp + offsetMinutes * 60_000).toISOString(),
  }));
}

export function calculateDirectSunMinutes(
  durationSeconds: number,
  shadeRatio: number | null,
): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new TypeError("durationSeconds must be non-negative");
  }
  if (shadeRatio === null) return null;
  if (!Number.isFinite(shadeRatio) || shadeRatio < 0 || shadeRatio > 1) {
    throw new TypeError("shadeRatio must be between zero and one");
  }

  return Math.round((durationSeconds / 60) * (1 - shadeRatio));
}

function normalizedBurden(value: number, minimum: number, maximum: number): number {
  return maximum === minimum ? 0 : (value - minimum) / (maximum - minimum);
}

function finiteValues(values: readonly (number | null)[]): readonly number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

/**
 * Selects the least burdensome departure using a transparent 50/35/15 blend:
 * apparent heat, direct sunlight, then walking duration. Missing measurements
 * are omitted and the remaining weights are rebalanced for that option.
 */
export function selectRecommendedDeparture(
  options: readonly DepartureOptionMetrics[],
): DepartureOffsetMinutes {
  if (options.length === 0) throw new TypeError("at least one departure option is required");

  const temperatures = finiteValues(options.map((option) => option.feelsLikeC));
  const sunMinutes = finiteValues(options.map((option) => option.directSunMinutes));
  const durations = options.map((option) => option.durationMinutes);
  if (durations.some((duration) => !Number.isFinite(duration) || duration < 0)) {
    throw new TypeError("durationMinutes must be non-negative");
  }
  const ranges = {
    temperature: [Math.min(...temperatures), Math.max(...temperatures)] as const,
    sun: [Math.min(...sunMinutes), Math.max(...sunMinutes)] as const,
    duration: [Math.min(...durations), Math.max(...durations)] as const,
  };

  const score = (option: DepartureOptionMetrics): number => {
    const metrics = [
      option.feelsLikeC === null || temperatures.length === 0
        ? null
        : {
            weight: 0.5,
            burden: normalizedBurden(
              option.feelsLikeC,
              ranges.temperature[0],
              ranges.temperature[1],
            ),
          },
      option.directSunMinutes === null || sunMinutes.length === 0
        ? null
        : {
            weight: 0.35,
            burden: normalizedBurden(option.directSunMinutes, ranges.sun[0], ranges.sun[1]),
          },
      {
        weight: 0.15,
        burden: normalizedBurden(option.durationMinutes, ranges.duration[0], ranges.duration[1]),
      },
    ].filter((metric): metric is { weight: number; burden: number } => metric !== null);
    const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);
    return metrics.reduce((sum, metric) => sum + metric.burden * metric.weight, 0) / totalWeight;
  };

  let recommended = options[0]!;
  let recommendedScore = score(recommended);
  for (const option of options.slice(1)) {
    const optionScore = score(option);
    if (
      optionScore < recommendedScore ||
      (optionScore === recommendedScore && option.offsetMinutes < recommended.offsetMinutes)
    ) {
      recommended = option;
      recommendedScore = optionScore;
    }
  }
  return recommended.offsetMinutes;
}
