import { z } from "zod";

export const DAEGU_WEATHER_LOCATION = {
  name: "대구광역시",
  latitude: 35.8685416666666,
  longitude: 128.603552777777,
  shortForecastGrid: { nx: 89, ny: 90 },
} as const;

const KstTimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/);
const CelsiusSchema = z.number().finite().min(-80).max(80);
const RelativeHumiditySchema = z.number().finite().min(0).max(100);

/**
 * Stull's approximation of wet-bulb temperature used by KMA's summer
 * apparent-temperature formula. Inputs are Celsius and relative humidity (%).
 */
export function stullWetBulbTemperatureC(
  airTemperatureC: number,
  relativeHumidityPct: number,
): number {
  const temperature = CelsiusSchema.parse(airTemperatureC);
  const humidity = RelativeHumiditySchema.parse(relativeHumidityPct);

  return (
    temperature * Math.atan(0.151977 * Math.sqrt(humidity + 8.313659)) +
    Math.atan(temperature + humidity) -
    Math.atan(humidity - 1.676331) +
    0.00391838 * humidity ** 1.5 * Math.atan(0.023101 * humidity) -
    4.686035
  );
}

/**
 * KMA summer apparent temperature (formula in use since 2022-06-02).
 * This is the documented TMP/REH fallback when APIHub `ta_chi` is unavailable.
 */
export function summerApparentTemperatureC(
  airTemperatureC: number,
  relativeHumidityPct: number,
): number {
  const temperature = CelsiusSchema.parse(airTemperatureC);
  const wetBulb = stullWetBulbTemperatureC(temperature, relativeHumidityPct);

  return (
    -0.2442 +
    0.55399 * wetBulb +
    0.45535 * temperature -
    0.0022 * wetBulb ** 2 +
    0.00278 * wetBulb * temperature +
    3
  );
}

export const Kma500mPointObservationSchema = z.object({
  observedAt: KstTimestampSchema,
  apparentTemperatureC: CelsiusSchema.nullable(),
  airTemperatureC: CelsiusSchema.nullable(),
  relativeHumidityPct: RelativeHumiditySchema.nullable(),
});

export type Kma500mPointObservation = z.infer<typeof Kma500mPointObservationSchema>;

export const VilageForecastSlotSchema = z.object({
  forecastAt: KstTimestampSchema,
  airTemperatureC: CelsiusSchema,
  relativeHumidityPct: RelativeHumiditySchema,
  grid: z.object({
    nx: z.number().int().positive(),
    ny: z.number().int().positive(),
  }),
});

export type VilageForecastSlot = z.infer<typeof VilageForecastSlotSchema>;

export const KmaHeatWarningSchema = z.object({
  regionCode: z.string().min(1),
  regionName: z.string().min(1),
  issuedAt: KstTimestampSchema,
  effectiveAt: KstTimestampSchema,
  kind: z.literal("HEAT"),
  level: z.enum(["WATCH", "WARNING"]),
  command: z.string().min(1),
});

export type KmaHeatWarning = z.infer<typeof KmaHeatWarningSchema>;

const DaeguLocationSchema = z.object({
  name: z.literal(DAEGU_WEATHER_LOCATION.name),
  latitude: z.literal(DAEGU_WEATHER_LOCATION.latitude),
  longitude: z.literal(DAEGU_WEATHER_LOCATION.longitude),
  shortForecastGrid: z.object({
    nx: z.literal(DAEGU_WEATHER_LOCATION.shortForecastGrid.nx),
    ny: z.literal(DAEGU_WEATHER_LOCATION.shortForecastGrid.ny),
  }),
});

export const NormalizedDaeguWeatherSchema = z.object({
  location: DaeguLocationSchema,
  primary: z.object({
    source: z.literal("KMA_APIHUB_500M"),
    observedAt: KstTimestampSchema,
    apparentTemperatureC: CelsiusSchema,
    airTemperatureC: CelsiusSchema,
    relativeHumidityPct: RelativeHumiditySchema,
  }),
  fallback: VilageForecastSlotSchema.extend({
    source: z.literal("KMA_VILAGE_FORECAST"),
  }),
  heatWarning: KmaHeatWarningSchema.nullable(),
});

export type NormalizedDaeguWeather = z.infer<typeof NormalizedDaeguWeatherSchema>;

const TextInputSchema = z.string().min(1);
const CompactTimestampSchema = z.string().regex(/^\d{12}$/);
const DateSchema = z.string().regex(/^\d{8}$/);
const TimeSchema = z.string().regex(/^\d{4}$/);
const NumberLikeSchema = z.union([z.number(), z.string()]);
const GridCoordinateSchema = z.preprocess(
  (value) => (typeof value === "string" ? Number(value) : value),
  z.number().int().positive(),
);

const VilageItemSchema = z.object({
  baseDate: DateSchema,
  baseTime: TimeSchema,
  category: z.string().min(1),
  fcstDate: DateSchema,
  fcstTime: TimeSchema,
  fcstValue: NumberLikeSchema,
  nx: GridCoordinateSchema,
  ny: GridCoordinateSchema,
});

const VilageResponseSchema = z.object({
  response: z.object({
    header: z.object({
      resultCode: z.string(),
      resultMsg: z.string(),
    }),
    body: z.object({
      items: z.object({
        item: z.array(VilageItemSchema),
      }),
    }),
  }),
});

const NormalizeInputSchema = z.object({
  apiHub500mPointText: TextInputSchema,
  vilageForecastResponse: z.unknown(),
  apiHubWarningText: TextInputSchema,
});

const MISSING_VALUES = new Set(["-", "null", "NULL", "NaN", "-999", "-999.0", "-9999", "-9999.0"]);

function splitFields(line: string): string[] {
  const trimmed = line.trim();
  return (trimmed.includes(",") ? trimmed.split(",") : trimmed.split(/\s+/))
    .map((field) => field.trim())
    .filter(Boolean);
}

function commentBody(line: string): string {
  return line.replace(/^#+\s*/, "").trim();
}

function findHeader(
  lines: readonly string[],
  requiredColumns: readonly string[],
): string[] | undefined {
  for (const line of lines) {
    const candidate = line.trim().startsWith("#") ? commentBody(line) : line.trim();
    const fields = splitFields(candidate);
    if (requiredColumns.every((column) => fields.includes(column))) {
      return fields;
    }
  }
  return undefined;
}

function dataLines(lines: readonly string[]): string[][] {
  return lines.flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return [];
    }
    const withoutInlineComment = trimmed.split("#", 1)[0]?.trim() ?? "";
    if (!withoutInlineComment) {
      return [];
    }
    return [splitFields(withoutInlineComment)];
  });
}

function columnIndex(header: readonly string[], name: string): number {
  const index = header.indexOf(name);
  if (index < 0) {
    throw new Error(`KMA response is missing required column: ${name}`);
  }
  return index;
}

function fieldAt(fields: readonly string[], index: number, name: string): string {
  const value = fields[index];
  if (value === undefined || value === "") {
    throw new Error(`KMA response row is missing required field: ${name}`);
  }
  return value;
}

function parseNullableMetric(input: string, schema: z.ZodNumber, name: string): number | null {
  if (MISSING_VALUES.has(input)) {
    return null;
  }
  const value = Number(input);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`KMA response contains invalid ${name}`);
  }
  return parsed.data;
}

function compactKstToIso(input: string): string {
  const compact = CompactTimestampSchema.parse(input);
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const hour = Number(compact.slice(8, 10));
  const minute = Number(compact.slice(10, 12));
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute
  ) {
    throw new Error(`Invalid KMA KST timestamp: ${input}`);
  }

  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(8, 10)}:${compact.slice(10, 12)}:00+09:00`;
}

function forecastKstToIso(date: string, time: string): string {
  DateSchema.parse(date);
  TimeSchema.parse(time);
  return compactKstToIso(`${date}${time}`);
}

export function parseKma500mPointText(input: string): Kma500mPointObservation[] {
  const lines = TextInputSchema.parse(input)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const requiredColumns = ["tm", "ta_chi", "ta", "hm"] as const;
  const declaredHeader = findHeader(lines, ["tm"]);
  const rows = dataLines(lines);
  const effectiveHeader =
    declaredHeader ??
    (rows.some((row) => CompactTimestampSchema.safeParse(row[0]).success)
      ? [...requiredColumns]
      : undefined);

  if (!effectiveHeader) {
    throw new Error("KMA 500m response is missing required columns: tm, ta_chi, ta, hm");
  }

  const indexes = {
    tm: columnIndex(effectiveHeader, "tm"),
    taChi: columnIndex(effectiveHeader, "ta_chi"),
    ta: columnIndex(effectiveHeader, "ta"),
    hm: columnIndex(effectiveHeader, "hm"),
  };

  const parsedRows = rows
    .filter((row) => CompactTimestampSchema.safeParse(row[indexes.tm]).success)
    .map((row) =>
      Kma500mPointObservationSchema.parse({
        observedAt: compactKstToIso(fieldAt(row, indexes.tm, "tm")),
        apparentTemperatureC: parseNullableMetric(
          fieldAt(row, indexes.taChi, "ta_chi"),
          CelsiusSchema,
          "ta_chi",
        ),
        airTemperatureC: parseNullableMetric(fieldAt(row, indexes.ta, "ta"), CelsiusSchema, "ta"),
        relativeHumidityPct: parseNullableMetric(
          fieldAt(row, indexes.hm, "hm"),
          RelativeHumiditySchema,
          "hm",
        ),
      }),
    );

  if (parsedRows.length === 0) {
    throw new Error("KMA 500m response contains no data rows");
  }

  return parsedRows.sort((left, right) => left.observedAt.localeCompare(right.observedAt));
}

type ForecastAccumulator = {
  forecastAt: string;
  grid: { nx: number; ny: number };
  airTemperatureC?: number | null;
  relativeHumidityPct?: number | null;
};

export function parseVilageForecastResponse(
  input: unknown,
  expectedGrid: { nx: number; ny: number } = DAEGU_WEATHER_LOCATION.shortForecastGrid,
): VilageForecastSlot[] {
  const grid = z
    .object({ nx: z.number().int().positive(), ny: z.number().int().positive() })
    .parse(expectedGrid);
  const parsed = VilageResponseSchema.parse(input);
  if (parsed.response.header.resultCode !== "00") {
    throw new Error(`KMA getVilageFcst resultCode is not 00: ${parsed.response.header.resultCode}`);
  }

  const slots = new Map<string, ForecastAccumulator>();
  for (const item of parsed.response.body.items.item) {
    if (
      item.nx !== grid.nx ||
      item.ny !== grid.ny ||
      (item.category !== "TMP" && item.category !== "REH")
    ) {
      continue;
    }

    const forecastAt = forecastKstToIso(item.fcstDate, item.fcstTime);
    const key = `${forecastAt}:${item.nx}:${item.ny}`;
    const slot = slots.get(key) ?? {
      forecastAt,
      grid: { nx: item.nx, ny: item.ny },
    };
    const rawValue = String(item.fcstValue);

    if (item.category === "TMP") {
      slot.airTemperatureC = parseNullableMetric(rawValue, CelsiusSchema, "TMP");
    } else {
      slot.relativeHumidityPct = parseNullableMetric(rawValue, RelativeHumiditySchema, "REH");
    }
    slots.set(key, slot);
  }

  const completeSlots = [...slots.values()]
    .filter(
      (
        slot,
      ): slot is ForecastAccumulator & {
        airTemperatureC: number;
        relativeHumidityPct: number;
      } =>
        slot.airTemperatureC !== null &&
        slot.airTemperatureC !== undefined &&
        slot.relativeHumidityPct !== null &&
        slot.relativeHumidityPct !== undefined,
    )
    .map((slot) => VilageForecastSlotSchema.parse(slot))
    .sort((left, right) => left.forecastAt.localeCompare(right.forecastAt));

  if (completeSlots.length === 0) {
    throw new Error("KMA getVilageFcst response has no requested slot containing both TMP and REH");
  }

  return completeSlots;
}

export function parseKmaWarningText(input: string): KmaHeatWarning[] {
  const lines = TextInputSchema.parse(input)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const requiredColumns = [
    "REG_UP",
    "REG_UP_KO",
    "REG_ID",
    "REG_KO",
    "TM_FC",
    "TM_EF",
    "WRN",
    "LVL",
    "CMD",
  ] as const;
  const rows = dataLines(lines);
  const header = findHeader(lines, requiredColumns) ?? [...requiredColumns];
  const indexes = Object.fromEntries(
    requiredColumns.map((column) => [column, columnIndex(header, column)]),
  ) as Record<(typeof requiredColumns)[number], number>;

  const warnings = rows.flatMap((row) => {
    if (row.length < requiredColumns.length) {
      return [];
    }
    const wrn = fieldAt(row, indexes.WRN, "WRN");
    const regionUpName = fieldAt(row, indexes.REG_UP_KO, "REG_UP_KO");
    const regionName = fieldAt(row, indexes.REG_KO, "REG_KO");
    const level = fieldAt(row, indexes.LVL, "LVL");
    if (
      wrn !== "H" ||
      (!regionUpName.includes("대구") && !regionName.includes("대구")) ||
      (level !== "2" && level !== "3")
    ) {
      return [];
    }

    return [
      KmaHeatWarningSchema.parse({
        regionCode: fieldAt(row, indexes.REG_ID, "REG_ID"),
        regionName,
        issuedAt: compactKstToIso(fieldAt(row, indexes.TM_FC, "TM_FC")),
        effectiveAt: compactKstToIso(fieldAt(row, indexes.TM_EF, "TM_EF")),
        kind: "HEAT",
        level: level === "3" ? "WARNING" : "WATCH",
        command: fieldAt(row, indexes.CMD, "CMD"),
      }),
    ];
  });

  return warnings.sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt));
}

export function normalizeDaeguWeather(input: unknown): NormalizedDaeguWeather {
  const sources = NormalizeInputSchema.parse(input);
  const pointRows = parseKma500mPointText(sources.apiHub500mPointText);
  const primary = [...pointRows]
    .reverse()
    .find(
      (row) =>
        row.apparentTemperatureC !== null &&
        row.airTemperatureC !== null &&
        row.relativeHumidityPct !== null,
    );
  if (
    !primary ||
    primary.apparentTemperatureC === null ||
    primary.airTemperatureC === null ||
    primary.relativeHumidityPct === null
  ) {
    throw new Error("No complete 500m observation is available");
  }

  const forecastSlots = parseVilageForecastResponse(sources.vilageForecastResponse);
  const fallback =
    forecastSlots.find((slot) => slot.forecastAt >= primary.observedAt) ?? forecastSlots.at(-1);
  if (!fallback) {
    throw new Error("No complete TMP/REH fallback forecast is available");
  }

  const warnings = parseKmaWarningText(sources.apiHubWarningText);
  const heatWarning =
    [...warnings].sort((left, right) => {
      const levelDifference =
        (right.level === "WARNING" ? 1 : 0) - (left.level === "WARNING" ? 1 : 0);
      return levelDifference || right.effectiveAt.localeCompare(left.effectiveAt);
    })[0] ?? null;

  return NormalizedDaeguWeatherSchema.parse({
    location: DAEGU_WEATHER_LOCATION,
    primary: {
      source: "KMA_APIHUB_500M",
      observedAt: primary.observedAt,
      apparentTemperatureC: primary.apparentTemperatureC,
      airTemperatureC: primary.airTemperatureC,
      relativeHumidityPct: primary.relativeHumidityPct,
    },
    fallback: {
      source: "KMA_VILAGE_FORECAST",
      ...fallback,
    },
    heatWarning,
  });
}
