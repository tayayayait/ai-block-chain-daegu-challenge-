import "@tanstack/react-start/server-only";

import { z } from "zod";

const GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
const QuerySchema = z.string().trim().min(2).max(120);
const CredentialSchema = z.string().trim().min(1);
const TimeoutSchema = z.number().int().min(50).max(30_000);

const AddressElementSchema = z
  .object({
    types: z.array(z.string()),
    longName: z.string(),
    shortName: z.string(),
    code: z.string(),
  })
  .passthrough();

const AddressSchema = z
  .object({
    roadAddress: z.string().default(""),
    jibunAddress: z.string().default(""),
    addressElements: z.array(AddressElementSchema).default([]),
    x: z.string().transform((value, context) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 124 || parsed > 132) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid longitude" });
        return z.NEVER;
      }
      return parsed;
    }),
    y: z.string().transform((value, context) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 33 || parsed > 39) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid latitude" });
        return z.NEVER;
      }
      return parsed;
    }),
  })
  .passthrough();

const ResponseSchema = z
  .object({
    status: z.literal("OK"),
    addresses: z.array(AddressSchema),
  })
  .passthrough();

export type NaverGeocodeErrorCode =
  "INVALID_QUERY" | "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR" | "INVALID_RESPONSE";

export class NaverGeocodeError extends Error {
  readonly code: NaverGeocodeErrorCode;

  constructor(code: NaverGeocodeErrorCode) {
    super(`NAVER geocoding unavailable: ${code}`);
    this.name = "NaverGeocodeError";
    this.code = code;
  }
}

export interface NaverAddressCandidate {
  label: string;
  roadAddress: string;
  jibunAddress: string;
  gu: string | null;
  latitude: number;
  longitude: number;
}

export type NaverGeocodeFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface NaverGeocoder {
  search(query: string): Promise<NaverAddressCandidate[]>;
}

function addressPart(
  elements: z.infer<typeof AddressElementSchema>[],
  type: "SIDO" | "SIGUGUN",
): string | null {
  return elements.find((element) => element.types.includes(type))?.longName ?? null;
}

export function createNaverGeocoder(options: {
  clientId: string;
  clientSecret: string;
  fetcher?: NaverGeocodeFetcher;
  timeoutMs?: number;
}): NaverGeocoder {
  const clientId = CredentialSchema.parse(options.clientId);
  const clientSecret = CredentialSchema.parse(options.clientSecret);
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = TimeoutSchema.parse(options.timeoutMs ?? 8_000);

  return {
    async search(query: string): Promise<NaverAddressCandidate[]> {
      const parsedQuery = QuerySchema.safeParse(query);
      if (!parsedQuery.success) throw new NaverGeocodeError("INVALID_QUERY");

      const url = new URL(GEOCODE_URL);
      url.searchParams.set("query", parsedQuery.data);
      url.searchParams.set("coordinate", "128.6014,35.8714");
      url.searchParams.set("count", "5");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetcher(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-ncp-apigw-api-key-id": clientId,
            "x-ncp-apigw-api-key": clientSecret,
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new NaverGeocodeError("HTTP_ERROR");

        let json: unknown;
        try {
          json = await response.json();
        } catch {
          throw new NaverGeocodeError("INVALID_RESPONSE");
        }
        const parsed = ResponseSchema.safeParse(json);
        if (!parsed.success) throw new NaverGeocodeError("INVALID_RESPONSE");

        return parsed.data.addresses
          .filter((address) => addressPart(address.addressElements, "SIDO") === "대구광역시")
          .map((address) => ({
            label: address.roadAddress || address.jibunAddress,
            roadAddress: address.roadAddress,
            jibunAddress: address.jibunAddress,
            gu: addressPart(address.addressElements, "SIGUGUN"),
            longitude: address.x,
            latitude: address.y,
          }));
      } catch (error) {
        if (error instanceof NaverGeocodeError) throw error;
        if (controller.signal.aborted) throw new NaverGeocodeError("TIMEOUT");
        throw new NaverGeocodeError("NETWORK_ERROR");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
