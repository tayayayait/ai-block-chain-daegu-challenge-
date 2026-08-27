import { describe, expect, it } from "vitest";

import { summerApparentTemperatureC, type VilageForecastSlot } from "@/integrations/kma/weather";
import { forecastForDeparture } from "./departure-forecast";

const slots: readonly VilageForecastSlot[] = [
  {
    forecastAt: "2026-08-26T15:00:00+09:00",
    airTemperatureC: 33,
    relativeHumidityPct: 50,
    grid: { nx: 89, ny: 91 },
  },
  {
    forecastAt: "2026-08-26T16:00:00+09:00",
    airTemperatureC: 35,
    relativeHumidityPct: 70,
    grid: { nx: 89, ny: 91 },
  },
];

describe("departure forecast selection", () => {
  it("uses an exact hourly forecast without interpolation", () => {
    expect(forecastForDeparture(slots, "2026-08-26T15:00:00+09:00")).toEqual({
      forecastAt: "2026-08-26T15:00:00+09:00",
      airTemperatureC: 33,
      relativeHumidityPct: 50,
      feelsLikeC: summerApparentTemperatureC(33, 50),
      interpolated: false,
    });
  });

  it("interpolates temperature and humidity for a 30-minute departure", () => {
    const result = forecastForDeparture(slots, "2026-08-26T15:30:00+09:00");

    expect(result).toMatchObject({
      forecastAt: "2026-08-26T15:30:00+09:00",
      airTemperatureC: 34,
      relativeHumidityPct: 60,
      interpolated: true,
    });
    expect(result?.feelsLikeC).toBeCloseTo(summerApparentTemperatureC(34, 60), 8);
  });

  it("uses the nearest slot only within the comparison horizon", () => {
    expect(forecastForDeparture(slots, "2026-08-26T14:30:00+09:00")).toMatchObject({
      forecastAt: "2026-08-26T15:00:00+09:00",
      interpolated: false,
    });
    expect(forecastForDeparture(slots, "2026-08-26T10:00:00+09:00")).toBeNull();
    expect(forecastForDeparture([], "2026-08-26T15:30:00+09:00")).toBeNull();
  });
});
