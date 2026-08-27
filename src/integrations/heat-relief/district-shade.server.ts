import "@tanstack/react-start/server-only";

import { z } from "zod";

const SUSEONG_ENDPOINT =
  "https://api.odcloud.kr/api/15116975/v1/uddi:0e6a9135-c17d-424b-b795-f5a347f39c17";
const DONGGU_ENDPOINT =
  "https://apis.data.go.kr/3420000/smartShadeOperationService/getSmartShadeOperation";
const CredentialSchema = z.string().trim().min(1);
const TimeoutSchema = z.number().int().min(1).max(30_000);
const PageSchema = z.number().int().min(1);
const PerPageSchema = z.number().int().min(1).max(1_000);

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;
type DistrictShadeSource = "SUSEONG_SHADE_API" | "DONGGU_SMART_SHADE_API";

export interface DistrictShadeFacility {
  readonly source: DistrictShadeSource;
  readonly sourceId: string;
  readonly kind: "SHADE_CANOPY";
  readonly name: string;
  readonly district: "수성구" | "동구";
  readonly administrativeDong: string | null;
  readonly address: string;
  readonly widthM: number | null;
  readonly installedAt: string | null;
  readonly datasetUpdatedAt: string | null;
  readonly detail: string | null;
  readonly coordinate: null;
}

export interface DistrictShadePage {
  readonly page: number;
  readonly perPage: number;
  readonly totalCount: number;
  readonly items: readonly DistrictShadeFacility[];
}

export class DistrictShadeProviderError extends Error {
  readonly provider: DistrictShadeSource;
  readonly code: "TIMEOUT" | "NETWORK_ERROR" | "HTTP_ERROR" | "INVALID_RESPONSE" | "PROVIDER_ERROR";

  constructor(
    provider: DistrictShadeSource,
    code: "TIMEOUT" | "NETWORK_ERROR" | "HTTP_ERROR" | "INVALID_RESPONSE" | "PROVIDER_ERROR",
  ) {
    super(provider + " unavailable: " + code);
    this.name = "DistrictShadeProviderError";
    this.provider = provider;
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).replace(/\s+/gu, " ").trim();
  return normalized ? normalized : null;
}

function number(value: unknown): number | null {
  const normalized = text(value);
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonnegativeInteger(value: unknown, fallback: number): number {
  const parsed = number(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function kstDateFromEpoch(value: unknown): string | null {
  const epoch = number(value);
  if (epoch === null || epoch <= 0) return null;
  const date = new Date(epoch + 9 * 60 * 60_000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

export function parseSuseongShadeResponse(input: unknown): DistrictShadePage {
  const root = record(input);
  if (!Array.isArray(root["data"])) {
    throw new DistrictShadeProviderError("SUSEONG_SHADE_API", "INVALID_RESPONSE");
  }
  const parsedItems = root["data"]
    .map((raw): DistrictShadeFacility | null => {
      const item = record(raw);
      const managementNumber = text(item["관리번호"]);
      const name = text(item["설치장소"]);
      const address = text(item["소재지주소"]);
      if (managementNumber === null || name === null || address === null) return null;
      return {
        source: "SUSEONG_SHADE_API",
        sourceId: "suseong-shade-" + managementNumber,
        kind: "SHADE_CANOPY",
        name,
        district: "수성구",
        administrativeDong: text(item["행정동"]),
        address,
        widthM: number(item["그늘막지름(M)"]),
        installedAt: null,
        datasetUpdatedAt: text(item["데이터기준일자"]),
        detail: null,
        coordinate: null,
      };
    })
    .filter((item): item is DistrictShadeFacility => item !== null);
  const seenIds = new Map<string, number>();
  const items = parsedItems.map((item) => {
    const occurrence = (seenIds.get(item.sourceId) ?? 0) + 1;
    seenIds.set(item.sourceId, occurrence);
    return occurrence === 1 ? item : { ...item, sourceId: item.sourceId + "-" + occurrence };
  });
  return {
    page: nonnegativeInteger(root["page"], 1),
    perPage: nonnegativeInteger(root["perPage"], items.length),
    totalCount: nonnegativeInteger(root["totalCount"], items.length),
    items,
  };
}

export function parseDongguSmartShadeResponse(
  input: unknown,
  requested: Readonly<{ page: number; perPage: number }> = { page: 1, perPage: 100 },
): DistrictShadePage {
  const response = record(record(input)["response"]);
  const header = record(response["header"]);
  const resultCode = text(header["resultCode"]);
  if (resultCode !== "00" && resultCode !== "0") {
    throw new DistrictShadeProviderError("DONGGU_SMART_SHADE_API", "PROVIDER_ERROR");
  }
  const body = record(response["body"]);
  const itemContainer = record(body["items"])["item"];
  const rawItems = Array.isArray(itemContainer)
    ? itemContainer
    : isRecord(itemContainer)
      ? [itemContainer]
      : [];
  const items = rawItems
    .map((raw): DistrictShadeFacility | null => {
      const item = record(raw);
      const registrationNumber = text(item["REG_NO"]);
      const name = text(item["ITLPC"]);
      const rawAddress = text(item["ADRES"]);
      if (registrationNumber === null || name === null || rawAddress === null) return null;
      return {
        source: "DONGGU_SMART_SHADE_API",
        sourceId: "donggu-smart-shade-" + registrationNumber,
        kind: "SHADE_CANOPY",
        name,
        district: "동구",
        administrativeDong: text(item["ADSTRD"]),
        address: "대구광역시 동구 " + rawAddress,
        widthM: null,
        installedAt: kstDateFromEpoch(item["INSTL_DE"]),
        datasetUpdatedAt: null,
        detail: text(item["RM"]),
        coordinate: null,
      };
    })
    .filter((item): item is DistrictShadeFacility => item !== null);
  return {
    page: requested.page,
    perPage: requested.perPage,
    totalCount: nonnegativeInteger(body["totalCount"], items.length),
    items,
  };
}

async function requestJson(input: {
  provider: DistrictShadeSource;
  url: URL;
  fetcher: Fetcher;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetcher(input.url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new DistrictShadeProviderError(input.provider, "HTTP_ERROR");
    try {
      return await response.json();
    } catch {
      throw new DistrictShadeProviderError(input.provider, "INVALID_RESPONSE");
    }
  } catch (error) {
    if (error instanceof DistrictShadeProviderError) throw error;
    if (controller.signal.aborted) {
      throw new DistrictShadeProviderError(input.provider, "TIMEOUT");
    }
    throw new DistrictShadeProviderError(input.provider, "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}

function commonOptions(options: { serviceKey: string; fetcher?: Fetcher; timeoutMs?: number }) {
  return {
    serviceKey: CredentialSchema.parse(options.serviceKey),
    fetcher: options.fetcher ?? fetch,
    timeoutMs: TimeoutSchema.parse(options.timeoutMs ?? 10_000),
  };
}

export function createSuseongShadeClient(options: {
  serviceKey: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}) {
  const resolved = commonOptions(options);
  return {
    async list(input: { page?: number; perPage?: number } = {}): Promise<DistrictShadePage> {
      const page = PageSchema.parse(input.page ?? 1);
      const perPage = PerPageSchema.parse(input.perPage ?? 1_000);
      const url = new URL(SUSEONG_ENDPOINT);
      url.searchParams.set("serviceKey", resolved.serviceKey);
      url.searchParams.set("page", String(page));
      url.searchParams.set("perPage", String(perPage));
      url.searchParams.set("returnType", "JSON");
      return parseSuseongShadeResponse(
        await requestJson({
          provider: "SUSEONG_SHADE_API",
          url,
          fetcher: resolved.fetcher,
          timeoutMs: resolved.timeoutMs,
        }),
      );
    },
  };
}

export function createDongguSmartShadeClient(options: {
  serviceKey: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}) {
  const resolved = commonOptions(options);
  return {
    async list(input: { page?: number; perPage?: number } = {}): Promise<DistrictShadePage> {
      const page = PageSchema.parse(input.page ?? 1);
      const perPage = PerPageSchema.parse(input.perPage ?? 100);
      const url = new URL(DONGGU_ENDPOINT);
      url.searchParams.set("serviceKey", resolved.serviceKey);
      url.searchParams.set("pageNo", String(page));
      url.searchParams.set("numOfRows", String(perPage));
      url.searchParams.set("type", "json");
      const json = await requestJson({
        provider: "DONGGU_SMART_SHADE_API",
        url,
        fetcher: resolved.fetcher,
        timeoutMs: resolved.timeoutMs,
      });
      return parseDongguSmartShadeResponse(json, { page, perPage });
    },
  };
}
