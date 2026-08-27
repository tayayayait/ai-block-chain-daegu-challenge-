import "@tanstack/react-start/server-only";

import { z } from "zod";

import type { NaverAddressCandidate } from "@/integrations/naver/geocode.server";

const TMAP_POI_ENDPOINT = "https://apis.openapi.sk.com/tmap/pois?version=1";
const QuerySchema = z.string().trim().min(2).max(120);
const CredentialSchema = z.string().trim().min(1);
const TimeoutSchema = z.number().int().min(50).max(30_000);

const TmapPoiItemSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().default(""),
    telNo: z.string().optional(),
    upperAddrName: z.string().default(""),
    middleAddrName: z.string().default(""),
    lowerAddrName: z.string().default(""),
    detailAddrName: z.string().default(""),
    roadName: z.string().default(""),
    firstBuildNo: z.string().default(""),
    secondBuildNo: z.string().default(""),
    noorLat: z.string().transform((val, ctx) => {
      const parsed = Number(val);
      if (!Number.isFinite(parsed) || parsed < 33 || parsed > 39) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid latitude" });
        return z.NEVER;
      }
      return parsed;
    }),
    noorLon: z.string().transform((val, ctx) => {
      const parsed = Number(val);
      if (!Number.isFinite(parsed) || parsed < 124 || parsed > 132) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid longitude" });
        return z.NEVER;
      }
      return parsed;
    }),
  })
  .passthrough();

const TmapPoiResponseSchema = z
  .object({
    searchPoiInfo: z
      .object({
        totalCount: z.union([z.string(), z.number()]).optional(),
        count: z.union([z.string(), z.number()]).optional(),
        pois: z
          .object({
            poi: z.array(TmapPoiItemSchema).default([]),
          })
          .optional()
          .default({ poi: [] }),
      })
      .optional(),
  })
  .passthrough();

export type TmapPoiErrorCode =
  "INVALID_QUERY" | "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR" | "INVALID_RESPONSE";

export class TmapPoiError extends Error {
  readonly code: TmapPoiErrorCode;

  constructor(code: TmapPoiErrorCode) {
    super(`TMAP POI search unavailable: ${code}`);
    this.name = "TmapPoiError";
    this.code = code;
  }
}

export type TmapPoiFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TmapPoiSearcher {
  search(query: string): Promise<NaverAddressCandidate[]>;
}

export function createTmapPoiSearcher(options: {
  appKey: string;
  fetcher?: TmapPoiFetcher;
  timeoutMs?: number;
}): TmapPoiSearcher {
  const appKey = CredentialSchema.parse(options.appKey);
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = TimeoutSchema.parse(options.timeoutMs ?? 8_000);

  return {
    async search(query: string): Promise<NaverAddressCandidate[]> {
      const parsedQuery = QuerySchema.safeParse(query);
      if (!parsedQuery.success) throw new TmapPoiError("INVALID_QUERY");

      const url = new URL(TMAP_POI_ENDPOINT);
      url.searchParams.set("searchKeyword", parsedQuery.data);
      url.searchParams.set("centerLat", "35.8714");
      url.searchParams.set("centerLon", "128.6014");
      url.searchParams.set("radius", "25");
      url.searchParams.set("count", "5");
      url.searchParams.set("reqCoordType", "WGS84GEO");
      url.searchParams.set("resCoordType", "WGS84GEO");
      url.searchParams.set("multiPoint", "N");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetcher(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            appKey,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 404 || response.status === 204) {
            return [];
          }
          throw new TmapPoiError("HTTP_ERROR");
        }

        let json: unknown;
        try {
          json = await response.json();
        } catch {
          throw new TmapPoiError("INVALID_RESPONSE");
        }

        const parsed = TmapPoiResponseSchema.safeParse(json);
        if (!parsed.success) throw new TmapPoiError("INVALID_RESPONSE");

        const rawPois = parsed.data.searchPoiInfo?.pois?.poi ?? [];

        return rawPois
          .filter((item) => {
            const sido = item.upperAddrName.trim();
            return sido.includes("대구") || sido === "대구광역시";
          })
          .map((item) => {
            const roadBuilding = [item.firstBuildNo, item.secondBuildNo].filter(Boolean).join("-");
            const roadAddr = [item.upperAddrName, item.middleAddrName, item.roadName, roadBuilding]
              .filter(Boolean)
              .join(" ")
              .trim();

            const jibunAddr = [
              item.upperAddrName,
              item.middleAddrName,
              item.lowerAddrName,
              item.detailAddrName,
            ]
              .filter(Boolean)
              .join(" ")
              .trim();

            const primaryAddress = roadAddr || jibunAddr;
            const label = item.name
              ? primaryAddress
                ? `${primaryAddress} (${item.name})`
                : item.name
              : primaryAddress;

            return {
              label,
              roadAddress: roadAddr,
              jibunAddress: jibunAddr,
              gu: item.middleAddrName || null,
              longitude: item.noorLon,
              latitude: item.noorLat,
            };
          });
      } catch (error) {
        if (error instanceof TmapPoiError) throw error;
        if (controller.signal.aborted) throw new TmapPoiError("TIMEOUT");
        throw new TmapPoiError("NETWORK_ERROR");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
