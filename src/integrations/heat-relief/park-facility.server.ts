import "@tanstack/react-start/server-only";

import { z } from "zod";

const BASE_URL = "https://apis.data.go.kr/6270000/dgInParkfacility";
const CredentialSchema = z.string().trim().min(1);
const PageSchema = z.number().int().min(1);
const PerPageSchema = z.number().int().min(1).max(1_000);
const LatitudeSchema = z.number().finite().min(35).max(37);
const LongitudeSchema = z.number().finite().min(128).max(130);
const RadiusSchema = z.number().finite().positive().max(50);
const TimeoutSchema = z.number().int().min(1).max(30_000);

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;
export type ParkRestType = "BENCH" | "PAVILION" | "PARK_FACILITY";

export interface DaeguPark {
  readonly sourceId: string;
  readonly managementNumber: string;
  readonly name: string;
  readonly parkType: string | null;
  readonly coordinate: Readonly<{ latitude: number; longitude: number }>;
  readonly district: string | null;
  readonly administrativeDong: string | null;
  readonly roadAddress: string | null;
  readonly lotAddress: string | null;
  readonly managerName: string | null;
  readonly managerPhone: string | null;
}

export interface DaeguParkFacility {
  readonly sourceId: string;
  readonly managementNumber: string | null;
  readonly parkManagementNumber: string;
  readonly parkName: string;
  readonly facilityName: string;
  readonly facilityType: string | null;
  readonly restType: ParkRestType | null;
  readonly condition: string | null;
  readonly repairRequired: boolean | null;
  readonly coordinate: Readonly<{ latitude: number; longitude: number }>;
  readonly locationDescription: string | null;
  readonly datasetUpdatedAt: string | null;
}

export interface ParkPage<T> {
  readonly page: number;
  readonly perPage: number;
  readonly totalCount: number;
  readonly items: readonly T[];
}

export class DaeguParkFacilityError extends Error {
  readonly provider = "DAEGU_PARK_FACILITY";
  readonly status: number | null;
  readonly code: "TIMEOUT" | "NETWORK_ERROR" | "HTTP_ERROR" | "INVALID_RESPONSE" | "PROVIDER_ERROR";

  constructor(
    code: "TIMEOUT" | "NETWORK_ERROR" | "HTTP_ERROR" | "INVALID_RESPONSE" | "PROVIDER_ERROR",
    status: number | null = null,
  ) {
    super("Daegu park facility service unavailable: " + code);
    this.name = "DaeguParkFacilityError";
    this.code = code;
    this.status = status;
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

function integer(value: unknown, fallback: number): number {
  const parsed = number(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function point(latitudeValue: unknown, longitudeValue: unknown) {
  const latitude = number(latitudeValue);
  const longitude = number(longitudeValue);
  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude } as const;
}

function itemsFromBody(body: JsonRecord): unknown[] {
  const item = record(body["items"])["item"];
  if (Array.isArray(item)) return item;
  return isRecord(item) ? [item] : [];
}

function assertSuccess(root: JsonRecord): JsonRecord {
  const header = record(root["header"]);
  const resultCode = text(header["resultCode"]);
  if (resultCode !== "00" && resultCode !== "0") {
    throw new DaeguParkFacilityError("PROVIDER_ERROR");
  }
  const body = root["body"];
  if (!isRecord(body)) throw new DaeguParkFacilityError("INVALID_RESPONSE");
  return body;
}

export function classifyParkRestType(
  facilityType: string | null,
  facilityName: string | null,
): ParkRestType | null {
  const value = (facilityType ?? "") + " " + (facilityName ?? "");
  if (/벤치/u.test(value)) return "BENCH";
  if (/정자|파고라|산장|대피소/u.test(value)) return "PAVILION";
  if (/음수대|급수대|쿨링|미스트|분수|물놀이/u.test(value)) return "PARK_FACILITY";
  return null;
}

export function parseParkListResponse(input: unknown): ParkPage<DaeguPark> {
  const root = record(input);
  const body = assertSuccess(root);
  const rawItems = itemsFromBody(body);
  const items = rawItems
    .map((raw): DaeguPark | null => {
      const item = record(raw);
      const id = text(item["id"]);
      const managementNumber = text(item["mngNo"]);
      const name = text(item["parkNm"]);
      const coordinate = point(item["lat"], item["lot"]);
      if (id === null || managementNumber === null || name === null || coordinate === null) {
        return null;
      }
      return {
        sourceId: "daegu-park-" + id,
        managementNumber,
        name,
        parkType: text(item["parkType"]),
        coordinate,
        district: text(item["sggNm"]),
        administrativeDong: text(item["dongNm"]),
        roadAddress: text(item["roadNmAddr"]),
        lotAddress: text(item["lotNoAddr"]),
        managerName: text(item["mngInstNm"]),
        managerPhone: text(item["mngInstTel"]),
      };
    })
    .filter((item): item is DaeguPark => item !== null);
  return {
    page: integer(body["pageNo"], 1),
    perPage: integer(body["numOfRows"], rawItems.length),
    totalCount: integer(body["totalCount"], rawItems.length),
    items,
  };
}

export function parseParkFacilityListResponse(input: unknown): ParkPage<DaeguParkFacility> {
  const root = record(input);
  const body = assertSuccess(root);
  const rawItems = itemsFromBody(body);
  const items = rawItems
    .map((raw): DaeguParkFacility | null => {
      const item = record(raw);
      const id = text(item["id"]);
      const parkManagementNumber = text(item["parkMngNo"]);
      const parkName = text(item["parkNm"]);
      const facilityName = text(item["facilityNm"]);
      const coordinate = point(item["lat"], item["lot"]);
      if (
        id === null ||
        parkManagementNumber === null ||
        parkName === null ||
        facilityName === null ||
        coordinate === null
      ) {
        return null;
      }
      const repairValue = text(item["rprReqYn"])?.toUpperCase() ?? null;
      const facilityType = text(item["facilityType"]);
      return {
        sourceId: "daegu-park-facility-" + id,
        managementNumber: text(item["mngNo"]),
        parkManagementNumber,
        parkName,
        facilityName,
        facilityType,
        restType: classifyParkRestType(facilityType, facilityName),
        condition: text(item["facilityStatus"]),
        repairRequired: repairValue === "Y" ? true : repairValue === "N" ? false : null,
        coordinate,
        locationDescription: text(item["locationDesc"]),
        datasetUpdatedAt: text(item["crtrYmd"]),
      };
    })
    .filter((item): item is DaeguParkFacility => item !== null);
  return {
    page: integer(body["pageNo"], 1),
    perPage: integer(body["numOfRows"], rawItems.length),
    totalCount: integer(body["totalCount"], rawItems.length),
    items,
  };
}

async function fetchJson(url: URL, fetcher: Fetcher, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new DaeguParkFacilityError("HTTP_ERROR", response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new DaeguParkFacilityError("INVALID_RESPONSE");
    }
  } catch (error) {
    if (error instanceof DaeguParkFacilityError) throw error;
    if (controller.signal.aborted) throw new DaeguParkFacilityError("TIMEOUT");
    throw new DaeguParkFacilityError("NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}

export function createDaeguParkFacilityClient(options: {
  serviceKey: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}) {
  const serviceKey = CredentialSchema.parse(options.serviceKey);
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = TimeoutSchema.parse(options.timeoutMs ?? 10_000);

  const nearbyUrl = (
    path: string,
    input: {
      latitude: number;
      longitude: number;
      radiusKm: number;
      page?: number;
      perPage?: number;
    },
  ) => {
    const page = PageSchema.parse(input.page ?? 1);
    const perPage = PerPageSchema.parse(input.perPage ?? 1_000);
    const latitude = LatitudeSchema.parse(input.latitude);
    const longitude = LongitudeSchema.parse(input.longitude);
    const radiusKm = RadiusSchema.parse(input.radiusKm);
    const url = new URL(BASE_URL + path);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", String(page));
    url.searchParams.set("numOfRows", String(perPage));
    url.searchParams.set("type", "json");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lot", String(longitude));
    url.searchParams.set("radius", String(radiusKm));
    return url;
  };

  return {
    async listParks(input: {
      latitude: number;
      longitude: number;
      radiusKm: number;
      page?: number;
      perPage?: number;
    }): Promise<ParkPage<DaeguPark>> {
      const url = nearbyUrl("/getDgFacilityParkList", input);
      return parseParkListResponse(await fetchJson(url, fetcher, timeoutMs));
    },
    async listFacilities(input: {
      parkManagementNumber: string;
      latitude: number;
      longitude: number;
      radiusKm: number;
      page?: number;
      perPage?: number;
    }): Promise<ParkPage<DaeguParkFacility>> {
      const managementNumber = z.string().trim().min(1).max(80).parse(input.parkManagementNumber);
      const url = nearbyUrl("/getDgFacilityList", input);
      url.searchParams.set("parkMngNo", managementNumber);
      return parseParkFacilityListResponse(await fetchJson(url, fetcher, timeoutMs));
    },
  };
}
