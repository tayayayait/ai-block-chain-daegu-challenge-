import { afterEach, describe, expect, it, vi } from "vitest";
import { easyDrugResponseFixture, pillResponseFixture } from "./fixtures/mfds-fixtures";
import {
  MFDS_CACHE_TTL_MS,
  type MedicationApiCacheEntry,
  type MedicationApiCacheRepository,
} from "./cache.server";
import { createDurClient, DUR_OPERATIONS } from "./dur.server";
import { createEasyDrugClient } from "./easy-drug.server";
import { createPillIdentificationClient } from "./pill-identification.server";

const expectedDurEndpoints = {
  PRODUCT: "getDurPrdlstInfoList03",
  COMBINATION_CONTRAINDICATION: "getUsjntTabooInfoList03",
  ELDERLY_CAUTION: "getOdsnAtentInfoList03",
  AGE_CONTRAINDICATION: "getSpcifyAgrdeTabooInfoList03",
  CAPACITY_CAUTION: "getCpctyAtentInfoList03",
  DURATION_CAUTION: "getMdctnPdAtentInfoList03",
  EFFICACY_DUPLICATION: "getEfcyDplctInfoList03",
  EXTENDED_RELEASE_SPLIT_CAUTION: "getSeobangjeongPartitnAtentInfoList03",
  PREGNANCY_CONTRAINDICATION: "getPwnmTabooInfoList03",
} as const;
import { durResponseFixtures } from "./fixtures/mfds-fixtures";

function createMemoryCache(
  savedEntries: MedicationApiCacheEntry[] = [],
): MedicationApiCacheRepository {
  const values = new Map<string, unknown>();
  return {
    async findFresh({ apiKind, requestHash }) {
      return values.get(`${apiKind}:${requestHash}`) ?? null;
    },
    async save(entry) {
      savedEntries.push(entry);
      values.set(`${entry.apiKind}:${entry.requestHash}`, entry.response);
    },
  };
}

describe("MFDS server clients", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses HTTPS and URL-encodes a decoded service key exactly once", async () => {
    let requestedUrl: URL | undefined;
    const client = createPillIdentificationClient({
      serviceKey: "decoded+/=key",
      fetcher: async (input) => {
        requestedUrl = new URL(String(input));
        return Response.json(pillResponseFixture);
      },
    });

    await client.search({ itemName: "온중정" });

    expect(requestedUrl?.origin).toBe("https://apis.data.go.kr");
    expect(requestedUrl?.pathname).toBe(
      "/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03",
    );
    expect(requestedUrl?.searchParams.get("serviceKey")).toBe("decoded+/=key");
    expect(requestedUrl?.toString()).toContain("serviceKey=decoded%2B%2F%3Dkey");
    expect(requestedUrl?.toString()).not.toContain("%252B");
  });

  it("reuses a fresh repository value and writes a 30-day cache entry", async () => {
    const savedEntries: MedicationApiCacheEntry[] = [];
    const cache = createMemoryCache(savedEntries);
    const fetcher = vi.fn(async () => Response.json(easyDrugResponseFixture));
    const now = new Date("2026-08-23T00:00:00.000Z");
    const client = createEasyDrugClient({
      serviceKey: "test-key",
      cache,
      fetcher,
      now: () => now,
    });

    await client.search({ itemSeq: "200000001" });
    const cached = await client.search({ itemSeq: "200000001" });

    expect(cached.items[0]?.itemSeq).toBe("200000001");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(savedEntries).toHaveLength(1);
    expect(savedEntries[0]!.expiresAt.getTime() - savedEntries[0]!.fetchedAt.getTime()).toBe(
      MFDS_CACHE_TTL_MS,
    );
  });

  it.each(DUR_OPERATIONS)("calls the official v03 endpoint for %s", async (operation) => {
    let pathname = "";
    const client = createDurClient({
      serviceKey: "test-key",
      fetcher: async (input) => {
        pathname = new URL(String(input)).pathname;
        return Response.json(durResponseFixtures[operation]);
      },
    });

    const result = await client.search(operation, { itemSeq: "200000001" });

    expect(pathname).toBe(`/1471000/DURPrdlstInfoService03/${expectedDurEndpoints[operation]}`);
    expect(result.items[0]?.operation).toBe(operation);
  });

  it("settles all nine DUR operations and marks one failed operation as partial", async () => {
    const requestedUrls: URL[] = [];
    const client = createDurClient({
      serviceKey: "test-key",
      fetcher: async (input) => {
        const url = new URL(String(input));
        requestedUrls.push(url);
        if (url.pathname.endsWith(expectedDurEndpoints.PREGNANCY_CONTRAINDICATION)) {
          return new Response("private provider detail", { status: 503 });
        }
        const operation = DUR_OPERATIONS.find((candidate) =>
          url.pathname.endsWith(expectedDurEndpoints[candidate]),
        );
        if (!operation) return new Response(null, { status: 404 });
        return Response.json(durResponseFixtures[operation]);
      },
    });

    const result = await client.getAllForItem("200000001");

    expect(requestedUrls).toHaveLength(9);
    expect(requestedUrls.every((url) => url.searchParams.get("numOfRows") === "10")).toBe(true);
    expect(result.status).toBe("PARTIAL");
    expect(result.operations.PRODUCT).toMatchObject({
      status: "AVAILABLE",
      page: { totalCount: 1 },
    });
    expect(result.operations.PREGNANCY_CONTRAINDICATION).toEqual({
      status: "UNAVAILABLE",
      page: null,
    });
  });

  it("caps each DUR operation payload at ten records even when the provider ignores numOfRows", async () => {
    const client = createDurClient({
      serviceKey: "test-key",
      fetcher: async (input) => {
        const url = new URL(String(input));
        const operation = DUR_OPERATIONS.find((candidate) =>
          url.pathname.endsWith(expectedDurEndpoints[candidate]),
        );
        if (!operation) return new Response(null, { status: 404 });
        const fixture = durResponseFixtures[operation];
        if (operation !== "PRODUCT") return Response.json(fixture);
        const item = fixture.body.items[0];
        return Response.json({
          ...fixture,
          body: {
            ...fixture.body,
            totalCount: 12,
            items: {
              item: Array.from({ length: 12 }, (_, index) => ({
                ...item,
                ITEM_SEQ: String(200000001 + index),
              })),
            },
          },
        });
      },
    });

    const result = await client.getAllForItem("200000001");

    expect(result.status).toBe("PARTIAL");
    expect(result.operations.PRODUCT.status).toBe("PARTIAL");
    expect(result.operations.PRODUCT.page?.items).toHaveLength(10);
  });

  it("treats cache repository failures as best-effort and still returns provider data", async () => {
    const fetcher = vi.fn(async () => Response.json(easyDrugResponseFixture));
    const client = createEasyDrugClient({
      serviceKey: "test-key",
      fetcher,
      cache: {
        findFresh: vi.fn(async () => Promise.reject(new Error("private database detail"))),
        save: vi.fn(async () => Promise.reject(new Error("private database detail"))),
      },
    });

    await expect(client.search({ itemSeq: "200000001" })).resolves.toMatchObject({
      items: [expect.objectContaining({ itemSeq: "200000001" })],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("turns HTTP failures into safe stable errors", async () => {
    const client = createEasyDrugClient({
      serviceKey: "do-not-leak-this-key",
      fetcher: async () => new Response("provider secret diagnostic", { status: 503 }),
    });

    const failure = client.search({ itemName: "온중정" });
    await expect(failure).rejects.toThrowError("MFDS_E_DRUG_HTTP_503");
    await expect(failure).rejects.not.toThrowError(/provider secret|do-not-leak/);
  });

  it("aborts slow requests and returns a safe timeout code", async () => {
    vi.useFakeTimers();
    const client = createPillIdentificationClient({
      serviceKey: "test-key",
      timeoutMs: 100,
      fetcher: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("raw abort detail")));
        }),
    });

    const request = client.search({ itemName: "온중정" });
    const timeoutExpectation = expect(request).rejects.toThrowError(
      "MFDS_PILL_IDENTIFICATION_TIMEOUT",
    );
    await vi.advanceTimersByTimeAsync(101);

    await timeoutExpectation;
    await expect(request).rejects.not.toThrowError(/raw abort detail/);
  });
});
