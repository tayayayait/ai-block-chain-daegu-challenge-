import { summerApparentTemperatureC, type VilageForecastSlot } from "@/integrations/kma/weather";

export interface DepartureForecast {
  readonly forecastAt: string;
  readonly airTemperatureC: number;
  readonly relativeHumidityPct: number;
  readonly feelsLikeC: number;
  readonly interpolated: boolean;
}

const MAX_NEAREST_SLOT_GAP_MS = 3 * 60 * 60_000;

function toDepartureForecast(
  forecastAt: string,
  airTemperatureC: number,
  relativeHumidityPct: number,
  interpolated: boolean,
): DepartureForecast {
  return {
    forecastAt,
    airTemperatureC,
    relativeHumidityPct,
    feelsLikeC: summerApparentTemperatureC(airTemperatureC, relativeHumidityPct),
    interpolated,
  };
}

export function forecastForDeparture(
  slots: readonly VilageForecastSlot[],
  departureAt: string,
): DepartureForecast | null {
  const target = Date.parse(departureAt);
  if (!Number.isFinite(target)) throw new TypeError("departureAt must be a valid timestamp");
  if (slots.length === 0) return null;

  const ordered = slots
    .map((slot) => ({ slot, timestamp: Date.parse(slot.forecastAt) }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  if (ordered.length === 0) return null;

  const exact = ordered.find((entry) => entry.timestamp === target);
  if (exact) {
    return toDepartureForecast(
      exact.slot.forecastAt,
      exact.slot.airTemperatureC,
      exact.slot.relativeHumidityPct,
      false,
    );
  }

  const before = [...ordered].reverse().find((entry) => entry.timestamp < target);
  const after = ordered.find((entry) => entry.timestamp > target);
  if (before && after) {
    const span = after.timestamp - before.timestamp;
    const progress = (target - before.timestamp) / span;
    const airTemperatureC =
      before.slot.airTemperatureC +
      (after.slot.airTemperatureC - before.slot.airTemperatureC) * progress;
    const relativeHumidityPct =
      before.slot.relativeHumidityPct +
      (after.slot.relativeHumidityPct - before.slot.relativeHumidityPct) * progress;
    return toDepartureForecast(departureAt, airTemperatureC, relativeHumidityPct, true);
  }

  const nearest = ordered.reduce((current, entry) =>
    Math.abs(entry.timestamp - target) < Math.abs(current.timestamp - target) ? entry : current,
  );
  if (Math.abs(nearest.timestamp - target) > MAX_NEAREST_SLOT_GAP_MS) return null;
  return toDepartureForecast(
    nearest.slot.forecastAt,
    nearest.slot.airTemperatureC,
    nearest.slot.relativeHumidityPct,
    false,
  );
}
