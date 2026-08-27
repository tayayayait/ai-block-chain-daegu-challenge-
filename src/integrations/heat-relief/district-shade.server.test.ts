import { describe, expect, it, vi } from "vitest";

import {
  createDongguSmartShadeClient,
  createSuseongShadeClient,
  parseDongguSmartShadeResponse,
  parseSuseongShadeResponse,
} from "./district-shade.server";

describe("district shade canopy adapters", () => {
  it("normalizes the Suseong odcloud address-only contract", () => {
    const page = parseSuseongShadeResponse({
      currentCount: 1,
      data: [
        {
          관리번호: "범어2",
          "그늘막지름(M)": "5.0",
          데이터기준일자: "2026-08-10",
          설치장소: "범어네거리 남동편(수성구청 라인)",
          소재지주소: "대구광역시 수성구 동대구로 330   (범어동)",
          행정동: "범어1동",
        },
      ],
      matchCount: 128,
      page: 1,
      perPage: 1000,
      totalCount: 128,
    });

    expect(page).toMatchObject({ page: 1, perPage: 1000, totalCount: 128 });
    expect(page.items).toEqual([
      expect.objectContaining({
        source: "SUSEONG_SHADE_API",
        sourceId: "suseong-shade-범어2",
        name: "범어네거리 남동편(수성구청 라인)",
        district: "수성구",
        administrativeDong: "범어1동",
        address: "대구광역시 수성구 동대구로 330 (범어동)",
        widthM: 5,
        coordinate: null,
        datasetUpdatedAt: "2026-08-10",
      }),
    ]);
  });

  it("normalizes the Donggu registry and interprets installation epoch in Korea time", () => {
    const page = parseDongguSmartShadeResponse(
      {
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
          body: {
            pageNo: 100,
            totalCount: 70,
            items: {
              item: [
                {
                  REG_NO: 1,
                  ADSTRD: "신천3동",
                  INSTL_DE: 1533826800000,
                  ITLPC: "대구동부소방서 앞",
                  ADRES: "신천동 73 ",
                  RM: null,
                },
              ],
            },
            numOfRows: 1,
          },
        },
      },
      { page: 1, perPage: 100 },
    );

    expect(page).toMatchObject({ page: 1, perPage: 100, totalCount: 70 });
    expect(page.items[0]).toMatchObject({
      source: "DONGGU_SMART_SHADE_API",
      sourceId: "donggu-smart-shade-1",
      name: "대구동부소방서 앞",
      district: "동구",
      administrativeDong: "신천3동",
      address: "대구광역시 동구 신천동 73",
      installedAt: "2018-08-10",
      coordinate: null,
    });
  });

  it("calls the two approved endpoints without exposing the service key in headers", async () => {
    const suseongFetcher = vi.fn().mockResolvedValue(
      Response.json({
        currentCount: 0,
        data: [],
        matchCount: 0,
        page: 1,
        perPage: 1000,
        totalCount: 0,
      }),
    );
    await createSuseongShadeClient({
      serviceKey: "fixture-key==",
      fetcher: suseongFetcher,
    }).list({ page: 2, perPage: 50 });
    const [suseongUrl] = suseongFetcher.mock.calls[0] as [URL, RequestInit];
    expect(suseongUrl.origin + suseongUrl.pathname).toBe(
      "https://api.odcloud.kr/api/15116975/v1/uddi:0e6a9135-c17d-424b-b795-f5a347f39c17",
    );
    expect(suseongUrl.searchParams.get("serviceKey")).toBe("fixture-key==");
    expect(suseongUrl.searchParams.get("page")).toBe("2");
    expect(suseongUrl.searchParams.get("perPage")).toBe("50");

    const dongguFetcher = vi.fn().mockResolvedValue(
      Response.json({
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
          body: {
            pageNo: 100,
            totalCount: 0,
            items: { item: [] },
            numOfRows: 1,
          },
        },
      }),
    );
    await createDongguSmartShadeClient({
      serviceKey: "fixture-key==",
      fetcher: dongguFetcher,
    }).list({ page: 1, perPage: 100 });
    const [dongguUrl] = dongguFetcher.mock.calls[0] as [URL, RequestInit];
    expect(dongguUrl.origin + dongguUrl.pathname).toBe(
      "https://apis.data.go.kr/3420000/smartShadeOperationService/getSmartShadeOperation",
    );
    expect(dongguUrl.searchParams.get("serviceKey")).toBe("fixture-key==");
    expect(dongguUrl.searchParams.get("pageNo")).toBe("1");
    expect(dongguUrl.searchParams.get("numOfRows")).toBe("100");
    expect(dongguUrl.searchParams.get("type")).toBe("json");
  });
});
