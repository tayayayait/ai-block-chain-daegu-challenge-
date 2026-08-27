import { describe, expect, it, vi } from "vitest";

import { createKakaoLocalSearcher, KakaoLocalError, type KakaoLocalFetcher } from "./local.server";

const MOCK_KAKAO_RESPONSE = {
  meta: { total_count: 2, pageable_count: 2, is_end: true },
  documents: [
    {
      id: "101",
      place_name: "교동119안전센터",
      category_name: "공공,사회기관 > 행정복지센터,소방서",
      address_name: "대구 중구 교동 119",
      road_address_name: "대구 중구 국채보상로 670",
      x: "128.6014",
      y: "35.8714",
    },
    {
      id: "102",
      place_name: "서울소방서",
      category_name: "공공,사회기관 > 소방서",
      address_name: "서울 종로구 세종로 1",
      road_address_name: "서울 종로구 세종대로 1",
      x: "126.978",
      y: "37.566",
    },
  ],
};

describe("Kakao Local Server Searcher", () => {
  it("searches by keyword with KakaoAK authorization and filters out non-Daegu addresses", async () => {
    const fetcher = vi.fn<KakaoLocalFetcher>(async () => Response.json(MOCK_KAKAO_RESPONSE));
    const searcher = createKakaoLocalSearcher({
      apiKey: "kakao-secret-key",
      fetcher,
    });

    const candidates = await searcher.search("교동 119");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      label: "대구 중구 국채보상로 670 (교동119안전센터)",
      roadAddress: "대구 중구 국채보상로 670",
      jibunAddress: "대구 중구 교동 119",
      gu: "중구",
      latitude: 35.8714,
      longitude: 128.6014,
    });

    const call = fetcher.mock.calls.at(0);
    expect(call).toBeDefined();
    if (!call) throw new Error("expected kakao search request");
    const [url, init] = call;
    const urlObj = new URL(String(url));
    expect(urlObj.searchParams.get("query")).toBe("교동 119");
    expect(urlObj.searchParams.get("x")).toBe("128.6014");
    expect(urlObj.searchParams.get("y")).toBe("35.8714");
    expect(init?.headers).toMatchObject({
      Authorization: "KakaoAK kakao-secret-key",
    });
  });

  it("rejects invalid queries shorter than 2 chars before calling provider", async () => {
    const fetcher = vi.fn();
    const searcher = createKakaoLocalSearcher({ apiKey: "key", fetcher });

    await expect(searcher.search(" ")).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("safely handles timeouts without leaking secrets", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("kakao-secret-key")));
      });
      return new Response();
    });

    const searcher = createKakaoLocalSearcher({
      apiKey: "kakao-secret-key",
      timeoutMs: 50,
      fetcher,
    });

    const error = await searcher.search("교동 119").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(KakaoLocalError);
    expect(error).toMatchObject({ code: "TIMEOUT" });
    expect(String(error)).not.toContain("kakao-secret-key");
  });

  it("handles malformed provider responses gracefully", async () => {
    const searcher = createKakaoLocalSearcher({
      apiKey: "key",
      fetcher: async () => Response.json({ documents: [{ x: "invalid_coordinate" }] }),
    });

    await expect(searcher.search("교동 119")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
