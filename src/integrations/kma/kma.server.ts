import "@tanstack/react-start/server-only";

import { z } from "zod";
import { getServerEnv } from "@/lib/env.server";
import {
  parseKma500mPointText,
  parseKmaWarningText,
  parseVilageForecastResponse,
  type Kma500mPointObservation,
  type KmaHeatWarning,
  type VilageForecastSlot,
} from "./weather";

const TimestampSchema = z.string().datetime({ offset: true });
const CoordinateSchema = z.number().finite();
const GridSchema = z.object({
  nx: z.number().int().positive(),
  ny: z.number().int().positive(),
});

const API_HUB_ORIGIN = "https://apihub.kma.go.kr";
const DATA_GO_ORIGIN = "https://apis.data.go.kr";
const VILLAGE_ISSUE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;
const ISSUE_AVAILABILITY_DELAY_MINUTES = 10;
const MAX_REQUEST_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 250;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Provider = "KMA_APIHUB" | "KMA_VILLAGE";

export class KmaProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "KmaProviderError";
  }
}

function kstDateParts(timestamp: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const value = new Date(timestamp + 9 * 60 * 60_000);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    hour: value.getUTCHours(),
    minute: value.getUTCMinutes(),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function compactKst(timestamp: number): string {
  const parts = kstDateParts(timestamp);
  return `${parts.year}${pad(parts.month)}${pad(parts.day)}${pad(parts.hour)}${pad(parts.minute)}`;
}

function kstDate(timestamp: number): string {
  return compactKst(timestamp).slice(0, 8);
}

export function latestVillageForecastBase(at: string): { baseDate: string; baseTime: string } {
  const timestamp = Date.parse(TimestampSchema.parse(at));
  const parts = kstDateParts(timestamp);
  const availableMinutes = parts.hour * 60 + parts.minute;
  const latestHour = [...VILLAGE_ISSUE_HOURS]
    .reverse()
    .find((hour) => hour * 60 + ISSUE_AVAILABILITY_DELAY_MINUTES <= availableMinutes);

  if (latestHour !== undefined) {
    return { baseDate: kstDate(timestamp), baseTime: `${pad(latestHour)}00` };
  }

  return {
    baseDate: kstDate(timestamp - 24 * 60 * 60_000),
    baseTime: "2300",
  };
}

async function fetchAndParseOnce<T>(input: {
  provider: Provider;
  url: URL;
  fetcher: Fetcher;
  timeoutMs: number;
  parse: (response: Response) => Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await input.fetcher(input.url, {
      method: "GET",
      headers: { accept: "application/json, text/plain;q=0.9" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new KmaProviderError(
        `${input.provider}_HTTP_${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    return await input.parse(response);
  } catch (error) {
    if (error instanceof KmaProviderError) throw error;
    if (controller.signal.aborted) {
      throw new KmaProviderError(`${input.provider}_TIMEOUT`, true);
    }
    throw new KmaProviderError(`${input.provider}_INVALID_RESPONSE`, false);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAndParse<T>(input: {
  provider: Provider;
  url: URL;
  fetcher: Fetcher;
  timeoutMs: number;
  parse: (response: Response) => Promise<T>;
}): Promise<T> {
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await fetchAndParseOnce(input);
    } catch (error) {
      const isLastAttempt = attempt === MAX_REQUEST_ATTEMPTS - 1;
      if (!(error instanceof KmaProviderError) || !error.retryable || isLastAttempt) throw error;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** attempt);
      });
    }
  }

  throw new Error("KMA_REQUEST_ATTEMPTS_EXHAUSTED");
}

export interface KmaClient {
  getPointObservations(input: {
    longitude: number;
    latitude: number;
    at: string;
  }): Promise<Kma500mPointObservation[]>;
  getCurrentHeatWarnings(at: string): Promise<KmaHeatWarning[]>;
  getVillageForecast(input: { nx: number; ny: number; at: string }): Promise<VilageForecastSlot[]>;
}

export function createKmaClient(options: {
  apiHubAuthKey: string;
  dataGoServiceKey: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}): KmaClient {
  const apiHubAuthKey = z.string().trim().min(1).parse(options.apiHubAuthKey);
  const dataGoServiceKey = z.string().trim().min(1).parse(options.dataGoServiceKey);
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = z
    .number()
    .int()
    .min(100)
    .max(30_000)
    .parse(options.timeoutMs ?? 10_000);

  return {
    async getPointObservations(input) {
      const longitude = CoordinateSchema.min(124).max(132).parse(input.longitude);
      const latitude = CoordinateSchema.min(32).max(40).parse(input.latitude);
      const at = Date.parse(TimestampSchema.parse(input.at));
      const url = new URL("/api/typ01/url/sfc_nc_var.php", API_HUB_ORIGIN);
      url.search = new URLSearchParams({
        tm1: compactKst(at - 60 * 60_000),
        tm2: compactKst(at),
        lon: String(longitude),
        lat: String(latitude),
        obs: "ta_chi,ta,hm",
        itv: "5",
        help: "1",
        authKey: apiHubAuthKey,
      }).toString();

      return fetchAndParse({
        provider: "KMA_APIHUB",
        url,
        fetcher,
        timeoutMs,
        parse: async (response) => parseKma500mPointText(await response.text()),
      });
    },

    async getCurrentHeatWarnings(at) {
      const timestamp = Date.parse(TimestampSchema.parse(at));
      const url = new URL("/api/typ01/url/wrn_now_data_new.php", API_HUB_ORIGIN);
      url.search = new URLSearchParams({
        fe: "e",
        tm: compactKst(timestamp),
        disp: "0",
        help: "0",
        authKey: apiHubAuthKey,
      }).toString();

      return fetchAndParse({
        provider: "KMA_APIHUB",
        url,
        fetcher,
        timeoutMs,
        parse: async (response) => parseKmaWarningText(await response.text()),
      });
    },

    async getVillageForecast(input) {
      const grid = GridSchema.parse(input);
      const base = latestVillageForecastBase(input.at);
      const url = new URL("/1360000/VilageFcstInfoService_2.0/getVilageFcst", DATA_GO_ORIGIN);
      url.search = new URLSearchParams({
        serviceKey: dataGoServiceKey,
        pageNo: "1",
        numOfRows: "1000",
        dataType: "JSON",
        base_date: base.baseDate,
        base_time: base.baseTime,
        nx: String(grid.nx),
        ny: String(grid.ny),
      }).toString();

      return fetchAndParse({
        provider: "KMA_VILLAGE",
        url,
        fetcher,
        timeoutMs,
        parse: async (response) => parseVilageForecastResponse(await response.json(), grid),
      });
    },
  };
}

export function createDefaultKmaClient(): KmaClient {
  const environment = getServerEnv();
  return createKmaClient({
    apiHubAuthKey: environment.KMA_APIHUB_AUTH_KEY,
    dataGoServiceKey: environment.DATA_GO_SERVICE_KEY,
  });
}
