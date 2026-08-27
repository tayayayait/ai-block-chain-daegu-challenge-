import "@tanstack/react-start/server-only";

import { z } from "zod";

import type { NaverAddressCandidate } from "@/integrations/naver/geocode.server";

const KAKAO_KEYWORD_ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";
const QuerySchema = z.string().trim().min(2).max(120);
const CredentialSchema = z.string().trim().min(1);
const TimeoutSchema = z.number().int().min(50).max(30_000);

const KakaoDocumentSchema = z
  .object({
    id: z.string().optional(),
    place_name: z.string().default(""),
    address_name: z.string().default(""),
    road_address_name: z.string().default(""),
    x: z.string().transform((val, ctx) => {
      const parsed = Number(val);
      if (!Number.isFinite(parsed) || parsed < 124 || parsed > 132) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid longitude" });
        return z.NEVER;
      }
      return parsed;
    }),
    y: z.string().transform((val, ctx) => {
      const parsed = Number(val);
      if (!Number.isFinite(parsed) || parsed < 33 || parsed > 39) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid latitude" });
        return z.NEVER;
      }
      return parsed;
    }),
  })
  .passthrough();

const KakaoResponseSchema = z
  .object({
    documents: z.array(KakaoDocumentSchema).default([]),
  })
  .passthrough();

export type KakaoLocalErrorCode =
  "INVALID_QUERY" | "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR" | "INVALID_RESPONSE";

export class KakaoLocalError extends Error {
  readonly code: KakaoLocalErrorCode;

  constructor(code: KakaoLocalErrorCode) {
    super(`Kakao local search unavailable: ${code}`);
    this.name = "KakaoLocalError";
    this.code = code;
  }
}

export type KakaoLocalFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface KakaoLocalSearcher {
  search(query: string): Promise<NaverAddressCandidate[]>;
}

function extractGu(address: string): string | null {
  const parts = address.split(" ");
  const guPart = parts.find(
    (part) =>
      !["대구", "대구시", "대구광역시", "서울", "서울시", "서울특별시"].includes(part) &&
      (part.endsWith("구") || part.endsWith("군")),
  );
  return guPart ?? null;
}

export function createKakaoLocalSearcher(options: {
  apiKey: string;
  fetcher?: KakaoLocalFetcher;
  timeoutMs?: number;
}): KakaoLocalSearcher {
  const apiKey = CredentialSchema.parse(options.apiKey);
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = TimeoutSchema.parse(options.timeoutMs ?? 8_000);

  return {
    async search(query: string): Promise<NaverAddressCandidate[]> {
      const parsedQuery = QuerySchema.safeParse(query);
      if (!parsedQuery.success) throw new KakaoLocalError("INVALID_QUERY");

      const url = new URL(KAKAO_KEYWORD_ENDPOINT);
      url.searchParams.set("query", parsedQuery.data);
      url.searchParams.set("x", "128.6014");
      url.searchParams.set("y", "35.8714");
      url.searchParams.set("radius", "25000");
      url.searchParams.set("size", "5");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetcher(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            Authorization: `KakaoAK ${apiKey}`,
          },
          signal: controller.signal,
        });

        if (!response.ok) throw new KakaoLocalError("HTTP_ERROR");

        let json: unknown;
        try {
          json = await response.json();
        } catch {
          throw new KakaoLocalError("INVALID_RESPONSE");
        }

        const parsed = KakaoResponseSchema.safeParse(json);
        if (!parsed.success) throw new KakaoLocalError("INVALID_RESPONSE");

        return parsed.data.documents
          .filter((doc) => {
            const fullAddress = `${doc.road_address_name} ${doc.address_name}`;
            return fullAddress.includes("대구");
          })
          .map((doc) => {
            const primaryAddress = doc.road_address_name || doc.address_name;
            const label = doc.place_name
              ? primaryAddress
                ? `${primaryAddress} (${doc.place_name})`
                : doc.place_name
              : primaryAddress;

            return {
              label,
              roadAddress: doc.road_address_name,
              jibunAddress: doc.address_name,
              gu: extractGu(doc.road_address_name) || extractGu(doc.address_name),
              longitude: doc.x,
              latitude: doc.y,
            };
          });
      } catch (error) {
        if (error instanceof KakaoLocalError) throw error;
        if (controller.signal.aborted) throw new KakaoLocalError("TIMEOUT");
        throw new KakaoLocalError("NETWORK_ERROR");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
