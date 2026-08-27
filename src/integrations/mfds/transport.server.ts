import "@tanstack/react-start/server-only";

import { z } from "zod";
import {
  createMedicationRequestHash,
  MFDS_CACHE_TTL_MS,
  type MedicationApiCacheRepository,
  type MedicationApiKind,
} from "./cache.server";
import { MfdsProviderError } from "./common.server";

const MFDS_ORIGIN = "https://apis.data.go.kr";
const ServiceKeySchema = z.string().trim().min(1);
const TimeoutSchema = z.number().int().min(50).max(30_000);

export type MfdsFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface MfdsTransportOptions {
  serviceKey: string;
  fetcher?: MfdsFetcher;
  cache?: MedicationApiCacheRepository;
  timeoutMs?: number;
  now?: () => Date;
}

export interface MfdsTransport {
  request<T>(input: {
    apiKind: MedicationApiKind;
    endpointPath: string;
    params: Readonly<Record<string, string>>;
    errorPrefix: string;
    parse: (value: unknown) => T;
  }): Promise<T>;
}

function decodeServiceKeyOnce(value: string): string {
  const parsed = ServiceKeySchema.parse(value);
  if (!parsed.includes("%")) return parsed;

  try {
    return decodeURIComponent(parsed);
  } catch {
    return parsed;
  }
}

export function createMfdsTransport(options: MfdsTransportOptions): MfdsTransport {
  const serviceKey = decodeServiceKeyOnce(options.serviceKey);
  const fetcher = options.fetcher ?? fetch;
  const cache = options.cache;
  const timeoutMs = TimeoutSchema.parse(options.timeoutMs ?? 10_000);
  const now = options.now ?? (() => new Date());

  return {
    async request<T>(input: {
      apiKind: MedicationApiKind;
      endpointPath: string;
      params: Readonly<Record<string, string>>;
      errorPrefix: string;
      parse: (value: unknown) => T;
    }): Promise<T> {
      const requestHash = createMedicationRequestHash(
        input.apiKind,
        input.endpointPath,
        input.params,
      );
      const requestedAt = now();

      if (cache) {
        let cached: unknown | null = null;
        try {
          cached = await cache.findFresh({
            apiKind: input.apiKind,
            requestHash,
            now: requestedAt,
          });
        } catch {
          // Cache is an optimization. A repository outage must not hide provider data.
        }
        if (cached !== null) {
          try {
            return input.parse(cached);
          } catch (error) {
            if (!(error instanceof MfdsProviderError)) {
              throw new MfdsProviderError(`${input.errorPrefix}_INVALID_RESPONSE`, false);
            }
            // A corrupt cache entry is ignored and refreshed from the provider.
          }
        }
      }

      const url = new URL(input.endpointPath, MFDS_ORIGIN);
      const search = new URLSearchParams(input.params);
      search.set("serviceKey", serviceKey);
      url.search = search.toString();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetcher(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new MfdsProviderError(
            `${input.errorPrefix}_HTTP_${response.status}`,
            response.status === 429 || response.status >= 500,
          );
        }

        let value: unknown;
        try {
          value = await response.json();
        } catch {
          throw new MfdsProviderError(`${input.errorPrefix}_INVALID_RESPONSE`, false);
        }

        let parsed: T;
        try {
          parsed = input.parse(value);
        } catch (error) {
          if (error instanceof MfdsProviderError) throw error;
          throw new MfdsProviderError(`${input.errorPrefix}_INVALID_RESPONSE`, false);
        }

        if (cache) {
          const fetchedAt = now();
          try {
            await cache.save({
              apiKind: input.apiKind,
              requestHash,
              response: value,
              fetchedAt,
              expiresAt: new Date(fetchedAt.getTime() + MFDS_CACHE_TTL_MS),
            });
          } catch {
            // Cache writes are best-effort and never change provider availability.
          }
        }
        return parsed;
      } catch (error) {
        if (error instanceof MfdsProviderError) throw error;
        if (controller.signal.aborted) {
          throw new MfdsProviderError(`${input.errorPrefix}_TIMEOUT`, true);
        }
        throw new MfdsProviderError(`${input.errorPrefix}_NETWORK`, true);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
