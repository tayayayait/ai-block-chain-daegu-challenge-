import { describe, expect, it, vi } from "vitest";

import {
  classifyParkRestType,
  createDaeguParkFacilityClient,
  parseParkFacilityListResponse,
  parseParkListResponse,
} from "./park-facility.server";

describe("Daegu park facility adapter", () => {
  it("normalizes the official nearby park contract", () => {
    const page = parseParkListResponse({
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: {
        items: {
          item: [
            {
              id: 71,
              mngNo: "27260-00075",
              parkNm: "수성공원",
              parkType: "근린공원",
              roadNmAddr: "",
              lotNoAddr: "대구광역시 수성구 수성동4가 1090-15",
              lat: "35.86055505",
              lot: "128.6148463",
              mngInstNm: "대구광역시 수성구청",
              mngInstTel: "053-666-2865",
              dongNm: "수성4가동",
              sggNm: "수성구",
            },
          ],
        },
        numOfRows: 3,
        pageNo: 1,
        totalCount: 12,
      },
    });

    expect(page).toMatchObject({ page: 1, perPage: 3, totalCount: 12 });
    expect(page.items[0]).toMatchObject({
      sourceId: "daegu-park-71",
      managementNumber: "27260-00075",
      name: "수성공원",
      parkType: "근린공원",
      coordinate: { latitude: 35.86055505, longitude: 128.6148463 },
      district: "수성구",
    });
  });

  it("classifies only facilities that are useful as heat-relief stops", () => {
    expect(classifyParkRestType("휴양시설", "벤치")).toBe("BENCH");
    expect(classifyParkRestType("휴양시설", "정자/산장/대피소")).toBe("PAVILION");
    expect(classifyParkRestType("편익시설", "음수대")).toBe("PARK_FACILITY");
    expect(classifyParkRestType("관리시설", "CCTV")).toBeNull();
  });

  it("keeps facility condition and repair evidence for safe filtering", () => {
    const page = parseParkFacilityListResponse({
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: {
        items: {
          item: [
            {
              id: 940,
              mngNo: "27260-00075-01-04-0001",
              locationNm: "수성공원",
              locationGb: "근린공원",
              facilityType: "휴양시설",
              facilityNm: "벤치",
              facilityStatus: "보통",
              rprReqYn: "N",
              locationDesc: "8",
              lat: "35.8605270386",
              lot: "128.6144256592",
              parkMngNo: "27260-00075",
              parkNm: "수성공원",
              crtrYmd: "2022-12-20",
            },
          ],
        },
        numOfRows: 20,
        pageNo: 1,
        totalCount: 20,
      },
    });

    expect(page.items[0]).toMatchObject({
      sourceId: "daegu-park-facility-940",
      restType: "BENCH",
      facilityName: "벤치",
      condition: "보통",
      repairRequired: false,
      coordinate: { latitude: 35.8605270386, longitude: 128.6144256592 },
      datasetUpdatedAt: "2022-12-20",
    });
  });

  it("uses the Swagger-confirmed lot and kilometer-radius parameters", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
        body: { items: { item: [] }, numOfRows: 25, pageNo: 2, totalCount: 0 },
      }),
    );
    const client = createDaeguParkFacilityClient({
      serviceKey: "fixture-key==",
      fetcher,
    });

    await client.listFacilities({
      parkManagementNumber: "27260-00075",
      latitude: 35.86,
      longitude: 128.61,
      radiusKm: 3,
      page: 2,
      perPage: 25,
    });

    const [url] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe(
      "https://apis.data.go.kr/6270000/dgInParkfacility/getDgFacilityList",
    );
    expect(url.searchParams.get("parkMngNo")).toBe("27260-00075");
    expect(url.searchParams.get("lat")).toBe("35.86");
    expect(url.searchParams.get("lot")).toBe("128.61");
    expect(url.searchParams.get("radius")).toBe("3");
    expect(url.searchParams.get("type")).toBe("json");
  });

  it("preserves an HTTP 429 status so sync jobs can retry rate limits", async () => {
    const client = createDaeguParkFacilityClient({
      serviceKey: "fixture-key==",
      fetcher: vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { resultCode: "23", resultMsg: "LIMITED_NUMBER_OF_SERVICE_REQUESTS" },
            { status: 429 },
          ),
        ),
    });

    await expect(
      client.listParks({
        latitude: 35.8714,
        longitude: 128.6014,
        radiusKm: 50,
      }),
    ).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 429,
    });
  });
});
