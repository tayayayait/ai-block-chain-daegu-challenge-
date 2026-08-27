import { describe, expect, it, vi } from "vitest";

import { createNaverGeocoder, NaverGeocodeError, type NaverGeocodeFetcher } from "./geocode.server";

const FIXTURE = {
  status: "OK",
  meta: { totalCount: 2, page: 1, count: 2 },
  addresses: [
    {
      roadAddress: "대구광역시 중구 국채보상로 670",
      jibunAddress: "대구광역시 중구 동인동2가 1",
      englishAddress: "",
      addressElements: [
        { types: ["SIDO"], longName: "대구광역시", shortName: "대구", code: "" },
        { types: ["SIGUGUN"], longName: "중구", shortName: "중구", code: "" },
      ],
      x: "128.601",
      y: "35.871",
      distance: 0,
    },
    {
      roadAddress: "서울특별시 중구 세종대로 110",
      jibunAddress: "서울특별시 중구 태평로1가 31",
      englishAddress: "",
      addressElements: [{ types: ["SIDO"], longName: "서울특별시", shortName: "서울", code: "" }],
      x: "126.978",
      y: "37.566",
      distance: 0,
    },
  ],
  errorMessage: "",
};

describe("NAVER server geocoder", () => {
  it("uses server-only credential headers and returns only Daegu candidates", async () => {
    const fetcher = vi.fn<NaverGeocodeFetcher>(async () => Response.json(FIXTURE));
    const geocoder = createNaverGeocoder({
      clientId: "id-secret-boundary",
      clientSecret: "client-secret",
      fetcher,
    });

    const candidates = await geocoder.search("대구 중구청");

    expect(candidates).toEqual([
      {
        label: "대구광역시 중구 국채보상로 670",
        roadAddress: "대구광역시 중구 국채보상로 670",
        jibunAddress: "대구광역시 중구 동인동2가 1",
        gu: "중구",
        latitude: 35.871,
        longitude: 128.601,
      },
    ]);
    const call = fetcher.mock.calls.at(0);
    expect(call).toBeDefined();
    if (!call) throw new Error("expected geocoder request");
    const [url, init] = call;
    expect(new URL(String(url)).searchParams.get("query")).toBe("대구 중구청");
    expect(init?.headers).toMatchObject({
      "x-ncp-apigw-api-key-id": "id-secret-boundary",
      "x-ncp-apigw-api-key": "client-secret",
    });
  });

  it("rejects malformed queries before any provider call", async () => {
    const fetcher = vi.fn();
    const geocoder = createNaverGeocoder({ clientId: "id", clientSecret: "secret", fetcher });

    await expect(geocoder.search(" ")).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps provider and timeout failures to safe codes without credential values", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("network client-secret")));
      });
      return new Response();
    });
    const geocoder = createNaverGeocoder({
      clientId: "id",
      clientSecret: "client-secret",
      timeoutMs: 50,
      fetcher,
    });

    const error = await geocoder.search("대구광역시청").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(NaverGeocodeError);
    expect(error).toMatchObject({ code: "TIMEOUT" });
    expect(String(error)).not.toContain("client-secret");
  });

  it("rejects an invalid provider schema at the Zod boundary", async () => {
    const geocoder = createNaverGeocoder({
      clientId: "id",
      clientSecret: "secret",
      fetcher: async () => Response.json({ status: "OK", addresses: [{ x: "oops" }] }),
    });

    await expect(geocoder.search("대구광역시청")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
