import "@tanstack/react-start/server-only";

import { z } from "zod";

const ENDPOINT = "https://api.data.go.kr/openapi/tn_pubr_public_shade_canopy_api";
const CredentialSchema = z.string().trim().min(1);
const TimeoutSchema = z.number().int().min(1).max(30_000);
const PageSchema = z.number().int().min(1);
const PerPageSchema = z.number().int().min(1).max(1_000);

type JsonRecord = Record<string, unknown>;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface NationalShadeFacility {
  readonly source: "NATIONAL_SHADE_CANOPY";
  readonly sourceId: string;
  readonly kind: "SHADE_CANOPY";
  readonly name: string;
  readonly coordinate: Readonly<{ latitude: number; longitude: number }> | null;
  readonly city: string | null;
  readonly district: string | null;
  readonly roadAddress: string | null;
  readonly lotAddress: string | null;
  readonly detail: string | null;
  readonly facilityType: string | null;
  readonly installedYear: number | null;
  readonly heightM: number | null;
  readonly widthM: number | null;
  readonly managerName: string | null;
  readonly managerPhone: string | null;
  readonly datasetUpdatedAt: string | null;
  readonly providerCode: string | null;
  readonly providerName: string | null;
}

export interface NationalShadePage {
  readonly page: number;
  readonly perPage: number;
  readonly totalCount: number;
  readonly items: readonly NationalShadeFacility[];
}

export type NationalShadeErrorCode =
  "TIMEOUT" | "NETWORK_ERROR" | "HTTP_ERROR" | "INVALID_RESPONSE" | "PROVIDER_ERROR";

export class NationalShadeProviderError extends Error {
  readonly provider = "NATIONAL_SHADE_CANOPY";

  constructor(readonly code: NationalShadeErrorCode) {
    super("National shade canopy service unavailable: " + code);
    this.name = "NationalShadeProviderError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function alias(object: JsonRecord, ...keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(object, key)) return object[key];
  }
  return undefined;
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function numberValue(value: unknown): number | null {
  const normalized = textValue(value);
  if (normalized === null) return null;
  const parsed = Number(normalized.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: unknown, fallback: number): number {
  const parsed = numberValue(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function stableId(values: readonly (string | number | null)[]): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(values.join("|").normalize("NFC"))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return "national-shade-" + hash.toString(16).padStart(16, "0");
}

const INVALID_COORDINATE = Symbol("INVALID_COORDINATE");

function coordinate(
  latitudeInput: unknown,
  longitudeInput: unknown,
): Readonly<{ latitude: number; longitude: number }> | null | typeof INVALID_COORDINATE {
  const latitudeText = textValue(latitudeInput);
  const longitudeText = textValue(longitudeInput);
  if (latitudeText === null && longitudeText === null) return null;
  if (latitudeText === null || longitudeText === null) return INVALID_COORDINATE;
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return INVALID_COORDINATE;
  }
  return { latitude, longitude };
}

function normalizeItem(input: unknown): NationalShadeFacility | null {
  const item = record(input);
  const name = textValue(alias(item, "instlPlcNm", "INSTL_PLC_NM"));
  if (name === null) return null;
  const normalizedCoordinate = coordinate(alias(item, "lat", "LAT"), alias(item, "lot", "LOT"));
  if (normalizedCoordinate === INVALID_COORDINATE) return null;
  const city = textValue(alias(item, "ctpvNm", "CTPV_NM"));
  const district = textValue(alias(item, "sggNm", "SGG_NM"));
  const roadAddress = textValue(alias(item, "lctnRoadNm", "LCTN_ROAD_NM"));
  const lotAddress = textValue(alias(item, "lctnLotnoAddr", "LCTN_LOTNO_ADDR"));
  const detail = textValue(alias(item, "actlPstn", "ACTL_PSTN"));
  const facilityType = textValue(alias(item, "shadeCanopyType", "SHADE_CANOPY_TYPE"));
  const installedYearValue = numberValue(alias(item, "instlYr", "INSTL_YR"));
  const installedYear =
    installedYearValue !== null &&
    Number.isInteger(installedYearValue) &&
    installedYearValue >= 1900 &&
    installedYearValue <= 2200
      ? installedYearValue
      : null;
  const managerName = textValue(alias(item, "mngInstNm", "MNG_INST_NM"));
  const providerCode = textValue(alias(item, "insttCode", "instt_code"));
  const datasetUpdatedAt = textValue(alias(item, "dataCrtrYmd", "DATA_CRTR_YMD"));
  return {
    source: "NATIONAL_SHADE_CANOPY",
    sourceId: stableId([
      providerCode,
      district,
      name,
      roadAddress,
      lotAddress,
      detail,
      normalizedCoordinate?.latitude ?? null,
      normalizedCoordinate?.longitude ?? null,
    ]),
    kind: "SHADE_CANOPY",
    name,
    coordinate: normalizedCoordinate,
    city,
    district,
    roadAddress,
    lotAddress,
    detail,
    facilityType,
    installedYear,
    heightM: numberValue(alias(item, "wholHgt", "WHOL_HGT")),
    widthM: numberValue(alias(item, "wholWdthLen", "WHOL_WDTH_LEN")),
    managerName,
    managerPhone: textValue(alias(item, "mngInstTelno", "MNG_INST_TELNO")),
    datasetUpdatedAt,
    providerCode,
    providerName: textValue(alias(item, "insttNm", "instt_nm")),
  };
}

export function parseNationalShadeResponse(input: unknown): NationalShadePage {
  const root = record(input);
  const response = isRecord(root["response"]) ? root["response"] : root;
  const header = record(response["header"]);
  const resultCode = textValue(alias(header, "resultCode", "result_code"));
  if (resultCode !== null && resultCode !== "00" && resultCode !== "0") {
    throw new NationalShadeProviderError("PROVIDER_ERROR");
  }
  const body = record(response["body"]);
  const rawItemsContainer = body["items"];
  const rawItems = Array.isArray(rawItemsContainer)
    ? rawItemsContainer
    : Array.isArray(record(rawItemsContainer)["item"])
      ? (record(rawItemsContainer)["item"] as unknown[])
      : isRecord(record(rawItemsContainer)["item"])
        ? [record(rawItemsContainer)["item"]]
        : [];
  return {
    page: integerValue(alias(body, "pageNo", "page"), 1),
    perPage: integerValue(alias(body, "numOfRows", "perPage"), rawItems.length),
    totalCount: integerValue(alias(body, "totalCount", "total_count"), rawItems.length),
    items: rawItems
      .map(normalizeItem)
      .filter((item): item is NationalShadeFacility => item !== null),
  };
}

export function createNationalShadeClient(options: {
  serviceKey: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}) {
  const serviceKey = CredentialSchema.parse(options.serviceKey);
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = TimeoutSchema.parse(options.timeoutMs ?? 10_000);

  return {
    async list(input: { page?: number; perPage?: number } = {}): Promise<NationalShadePage> {
      const page = PageSchema.parse(input.page ?? 1);
      const perPage = PerPageSchema.parse(input.perPage ?? 1_000);
      const url = new URL(ENDPOINT);
      url.searchParams.set("serviceKey", serviceKey);
      url.searchParams.set("pageNo", String(page));
      url.searchParams.set("numOfRows", String(perPage));
      url.searchParams.set("type", "json");
      url.searchParams.set("CTPV_NM", "대구광역시");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new NationalShadeProviderError("HTTP_ERROR");
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          throw new NationalShadeProviderError("INVALID_RESPONSE");
        }
        return parseNationalShadeResponse(json);
      } catch (error) {
        if (error instanceof NationalShadeProviderError) throw error;
        if (controller.signal.aborted) throw new NationalShadeProviderError("TIMEOUT");
        throw new NationalShadeProviderError("NETWORK_ERROR");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
