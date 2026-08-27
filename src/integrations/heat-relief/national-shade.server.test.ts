import { describe, expect, it, vi } from "vitest";

import { createNationalShadeClient, parseNationalShadeResponse } from "./national-shade.server";

describe("national shade canopy adapter", () => {
  it("normalizes the live camelCase response contract", () => {
    const result = parseNationalShadeResponse({
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: {
        items: {
          item: [
            {
              instlPlcNm: "금호워터폴리스 내",
              ctpvNm: "대구광역시",
              sggNm: "북구",
              lctnRoadNm: "",
              lctnLotnoAddr: "대구광역시 북구 검단동 1573",
              lat: "35.92206371",
              lot: "128.621718",
              shadeCanopyType: "스마트그늘막",
              actlPstn: "교통섬",
              instlYr: "2025",
              wholHgt: "3.5",
              wholWdthLen: "5",
              mngInstNm: "대구광역시 북구",
              mngInstTelno: "053-665-4355",
              dataCrtrYmd: "2025-07-31",
              insttCode: "3450000",
              insttNm: "대구광역시 북구",
            },
          ],
        },
        numOfRows: 100,
        pageNo: 1,
        totalCount: 475,
      },
    });

    expect(result).toMatchObject({ page: 1, perPage: 100, totalCount: 475 });
    expect(result.items).toEqual([
      expect.objectContaining({
        source: "NATIONAL_SHADE_CANOPY",
        kind: "SHADE_CANOPY",
        name: "금호워터폴리스 내",
        coordinate: { latitude: 35.92206371, longitude: 128.621718 },
        city: "대구광역시",
        district: "북구",
        lotAddress: "대구광역시 북구 검단동 1573",
        detail: "교통섬",
        facilityType: "스마트그늘막",
        installedYear: 2025,
        heightM: 3.5,
        widthM: 5,
        managerName: "대구광역시 북구",
        managerPhone: "053-665-4355",
        datasetUpdatedAt: "2025-07-31",
      }),
    ]);
    expect(result.items[0]?.sourceId).toMatch(/^national-shade-/u);
  });

  it("accepts documented uppercase aliases and keeps address-only records", () => {
    const result = parseNationalShadeResponse({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL_CODE" },
        body: {
          items: [
            {
              INSTL_PLC_NM: "주소만 있는 그늘막",
              CTPV_NM: "대구광역시",
              SGG_NM: "달서구",
              LCTN_ROAD_NM: "대구광역시 달서구 달구벌대로 1",
              LAT: "",
              LOT: null,
              SHADE_CANOPY_TYPE: "접이식그늘막",
              DATA_CRTR_YMD: "2026-07-03",
              instt_code: "3470000",
            },
          ],
          numOfRows: "10",
          pageNo: "2",
          totalCount: "11",
        },
      },
    });

    expect(result).toMatchObject({ page: 2, perPage: 10, totalCount: 11 });
    expect(result.items[0]).toMatchObject({
      name: "주소만 있는 그늘막",
      coordinate: null,
      roadAddress: "대구광역시 달서구 달구벌대로 1",
    });
  });

  it("drops records with supplied but invalid or incomplete coordinates", () => {
    const result = parseNationalShadeResponse({
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: {
        items: {
          item: [
            { instlPlcNm: "위도 범위 오류", lat: "128.6", lot: "35.8" },
            { instlPlcNm: "경도 누락", lat: "35.8", lot: "" },
            {
              instlPlcNm: "정상",
              lat: 35.8,
              lot: 128.6,
              lctnLotnoAddr: "대구광역시 달서구",
            },
          ],
        },
        numOfRows: 3,
        pageNo: 1,
        totalCount: 3,
      },
    });

    expect(result.items.map(({ name }) => name)).toEqual(["정상"]);
  });

  it("calls the official endpoint with an encoded service key and Daegu filter", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
        body: { items: { item: [] }, numOfRows: 25, pageNo: 2, totalCount: 0 },
      }),
    );
    const client = createNationalShadeClient({
      serviceKey: "fixture-key==",
      fetcher,
      timeoutMs: 1_000,
    });

    await expect(client.list({ page: 2, perPage: 25 })).resolves.toMatchObject({
      page: 2,
      perPage: 25,
      totalCount: 0,
    });

    const [input, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(input.origin + input.pathname).toBe(
      "https://api.data.go.kr/openapi/tn_pubr_public_shade_canopy_api",
    );
    expect(input.searchParams.get("serviceKey")).toBe("fixture-key==");
    expect(input.searchParams.get("pageNo")).toBe("2");
    expect(input.searchParams.get("numOfRows")).toBe("25");
    expect(input.searchParams.get("type")).toBe("json");
    expect(input.searchParams.get("CTPV_NM")).toBe("대구광역시");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns a stable timeout error without leaking the service key", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(
        async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted")));
          }),
      );
      const client = createNationalShadeClient({
        serviceKey: "do-not-leak",
        fetcher,
        timeoutMs: 5,
      });
      const request = client.list();
      const expectation = expect(request).rejects.toMatchObject({
        code: "TIMEOUT",
        provider: "NATIONAL_SHADE_CANOPY",
      });

      await vi.advanceTimersByTimeAsync(10);
      await expectation;
      await request.catch((error: unknown) => {
        expect(String(error)).not.toContain("do-not-leak");
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
