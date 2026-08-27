import { describe, expect, it } from "vitest";

import {
  apiHub500mPointTextFixture,
  apiHubWarningTextFixture,
  vilageForecastJsonFixture,
} from "./fixtures/weather-fixtures";
import {
  DAEGU_WEATHER_LOCATION,
  NormalizedDaeguWeatherSchema,
  normalizeDaeguWeather,
  parseKma500mPointText,
  parseKmaWarningText,
  parseVilageForecastResponse,
  summerApparentTemperatureC,
  stullWetBulbTemperatureC,
} from "./weather";

describe("KMA summer apparent-temperature fallback", () => {
  it("implements the official Stull wet-bulb estimate and KMA summer formula", () => {
    expect(stullWetBulbTemperatureC(33, 58)).toBeCloseTo(26.3389, 4);
    expect(summerApparentTemperatureC(33, 58)).toBeCloseTo(33.2639, 4);
  });

  it.each([
    [Number.NaN, 50],
    [30, -0.1],
    [30, 100.1],
    [-80.1, 50],
    [80.1, 50],
  ])("rejects invalid TMP/REH values (%s, %s)", (temperatureC, humidityPct) => {
    expect(() => summerApparentTemperatureC(temperatureC, humidityPct)).toThrow();
  });
});

describe("parseKma500mPointText", () => {
  it("parses comments, variable whitespace, inline comments, and missing sentinels", () => {
    const rows = parseKma500mPointText(apiHub500mPointTextFixture);

    expect(rows).toEqual([
      {
        observedAt: "2026-08-23T14:30:00+09:00",
        apparentTemperatureC: 34.1,
        airTemperatureC: 32,
        relativeHumidityPct: 61,
      },
      {
        observedAt: "2026-08-23T14:35:00+09:00",
        apparentTemperatureC: null,
        airTemperatureC: 32.3,
        relativeHumidityPct: 60,
      },
      {
        observedAt: "2026-08-23T14:40:00+09:00",
        apparentTemperatureC: 34.6,
        airTemperatureC: 32.4,
        relativeHumidityPct: 59,
      },
    ]);
  });

  it("rejects a response without the required ta_chi column", () => {
    const withoutFeelsLike = `
# tm ta hm
202608231440 32.4 59
`;

    expect(() => parseKma500mPointText(withoutFeelsLike)).toThrow(/ta_chi/);
  });

  it("uses the documented query order when help=0 omits the column header", () => {
    const headerless = "202608231440 34.6 32.4 59";

    expect(parseKma500mPointText(headerless)).toEqual([
      {
        observedAt: "2026-08-23T14:40:00+09:00",
        apparentTemperatureC: 34.6,
        airTemperatureC: 32.4,
        relativeHumidityPct: 59,
      },
    ]);
  });
});

describe("parseVilageForecastResponse", () => {
  it("pairs TMP and REH for the same Daegu grid forecast slot", () => {
    expect(parseVilageForecastResponse(vilageForecastJsonFixture)).toEqual([
      {
        forecastAt: "2026-08-23T15:00:00+09:00",
        airTemperatureC: 33,
        relativeHumidityPct: 58,
        grid: { nx: 89, ny: 90 },
      },
    ]);
  });

  it("rejects a non-success provider result code", () => {
    const failure = {
      response: {
        header: { resultCode: "03", resultMsg: "NO_DATA" },
        body: { items: { item: [] } },
      },
    };

    expect(() => parseVilageForecastResponse(failure)).toThrow(/resultCode/);
  });

  it("rejects a forecast slot that is missing REH", () => {
    const missingHumidity = {
      response: {
        ...vilageForecastJsonFixture.response,
        body: {
          ...vilageForecastJsonFixture.response.body,
          items: {
            item: vilageForecastJsonFixture.response.body.items.item.filter(
              (item) => item.category !== "REH",
            ),
          },
        },
      },
    };

    expect(() => parseVilageForecastResponse(missingHumidity)).toThrow(/TMP.*REH|REH.*TMP/);
  });
});

describe("parseKmaWarningText", () => {
  it("normalizes current Daegu heat warnings and ignores other regions and kinds", () => {
    expect(parseKmaWarningText(apiHubWarningTextFixture)).toEqual([
      {
        regionCode: "L1070100",
        regionName: "대구",
        issuedAt: "2026-08-23T11:00:00+09:00",
        effectiveAt: "2026-08-23T12:00:00+09:00",
        kind: "HEAT",
        level: "WATCH",
        command: "1",
      },
    ]);
  });

  it("uses the documented current-warning order when help=0 omits the header", () => {
    const headerless = "27 대구광역시 L1070100 대구 202608231100 202608231200 H 3 1";

    expect(parseKmaWarningText(headerless)[0]?.level).toBe("WARNING");
  });
});

describe("normalizeDaeguWeather", () => {
  it("returns a Zod-validated normalized DTO using primary, fallback, and warning sources", () => {
    const weather = normalizeDaeguWeather({
      apiHub500mPointText: apiHub500mPointTextFixture,
      vilageForecastResponse: vilageForecastJsonFixture,
      apiHubWarningText: apiHubWarningTextFixture,
    });

    expect(weather).toEqual({
      location: DAEGU_WEATHER_LOCATION,
      primary: {
        source: "KMA_APIHUB_500M",
        observedAt: "2026-08-23T14:40:00+09:00",
        apparentTemperatureC: 34.6,
        airTemperatureC: 32.4,
        relativeHumidityPct: 59,
      },
      fallback: {
        source: "KMA_VILAGE_FORECAST",
        forecastAt: "2026-08-23T15:00:00+09:00",
        airTemperatureC: 33,
        relativeHumidityPct: 58,
        grid: { nx: 89, ny: 90 },
      },
      heatWarning: {
        regionCode: "L1070100",
        regionName: "대구",
        issuedAt: "2026-08-23T11:00:00+09:00",
        effectiveAt: "2026-08-23T12:00:00+09:00",
        kind: "HEAT",
        level: "WATCH",
        command: "1",
      },
    });
    expect(NormalizedDaeguWeatherSchema.safeParse(weather).success).toBe(true);
  });

  it("rejects normalization when every 500m row has a missing required value", () => {
    const onlyMissing = `
# tm ta_chi ta hm
202608231440 -999.0 32.4 59
`;

    expect(() =>
      normalizeDaeguWeather({
        apiHub500mPointText: onlyMissing,
        vilageForecastResponse: vilageForecastJsonFixture,
        apiHubWarningText: apiHubWarningTextFixture,
      }),
    ).toThrow(/complete 500m/i);
  });
});
