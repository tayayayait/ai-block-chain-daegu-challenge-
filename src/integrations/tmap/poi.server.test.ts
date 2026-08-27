import { describe, expect, it, vi } from "vitest";

import { createTmapPoiSearcher, TmapPoiError, type TmapPoiFetcher } from "./poi.server";

const MOCK_TMAP_POI_RESPONSE = {
  searchPoiInfo: {
    totalCount: "2",
    count: "2",
    page: "1",
    pois: {
      poi: [
        {
          id: "201",
          name: "교동119안전센터",
          upperAddrName: "대구광역시",
          middleAddrName: "중구",
          lowerAddrName: "교동",
          detailAddrName: "119",
          roadName: "국채보상로",
          firstBuildNo: "670",
          secondBuildNo: "",
          noorLat: "35.8714",
          noorLon: "128.6014",
        },
        {
          id: "202",
          name: "서울119안전센터",
          upperAddrName: "서울특별시",
          middleAddrName: "종로구",
          lowerAddrName: "세종로",
          detailAddrName: "1",
          roadName: "세종대로",
          firstBuildNo: "1",
          secondBuildNo: "",
          noorLat: "37.566",
          noorLon: "126.978",
        },
      ],
    },
  },
};

describe("TMAP POI Server Searcher", () => {
  it("searches POIs by keyword with appKey and filters for Daegu results", async () => {
    const fetcher = vi.fn<TmapPoiFetcher>(async () => Response.json(MOCK_TMAP_POI_RESPONSE));
    const searcher = createTmapPoiSearcher({
      appKey: "tmap-app-key",
      fetcher,
    });

    const candidates = await searcher.search("교동 119");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      label: "대구광역시 중구 국채보상로 670 (교동119안전센터)",
      roadAddress: "대구광역시 중구 국채보상로 670",
      jibunAddress: "대구광역시 중구 교동 119",
      gu: "중구",
      latitude: 35.8714,
      longitude: 128.6014,
    });

    const call = fetcher.mock.calls.at(0);
    expect(call).toBeDefined();
    if (!call) throw new Error("expected tmap poi search request");
    const [url, init] = call;
    const urlObj = new URL(String(url));
    expect(urlObj.searchParams.get("searchKeyword")).toBe("교동 119");
    expect(init?.headers).toMatchObject({
      appKey: "tmap-app-key",
    });
  });

  it("rejects invalid queries shorter than 2 chars before calling provider", async () => {
    const fetcher = vi.fn();
    const searcher = createTmapPoiSearcher({ appKey: "key", fetcher });

    await expect(searcher.search(" ")).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("handles 404/204 as empty results gracefully", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
    const searcher = createTmapPoiSearcher({ appKey: "key", fetcher });

    const results = await searcher.search("없는장소검색어123");
    expect(results).toEqual([]);
  });

  it("safely handles timeouts without leaking secrets", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("tmap-app-key")));
      });
      return new Response();
    });

    const searcher = createTmapPoiSearcher({
      appKey: "tmap-app-key",
      timeoutMs: 50,
      fetcher,
    });

    const error = await searcher.search("교동 119").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TmapPoiError);
    expect(error).toMatchObject({ code: "TIMEOUT" });
    expect(String(error)).not.toContain("tmap-app-key");
  });
});
