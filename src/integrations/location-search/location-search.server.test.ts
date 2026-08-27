import { describe, expect, it, vi } from "vitest";

import { createSmartLocationSearcher } from "./location-search.server";

describe("Smart Location Searcher", () => {
  const MOCK_CANDIDATE = {
    label: "대구 중구 국채보상로 670 (교동119안전센터)",
    roadAddress: "대구 중구 국채보상로 670",
    jibunAddress: "대구 중구 교동 119",
    gu: "중구",
    latitude: 35.8714,
    longitude: 128.6014,
  };

  it("prioritizes Kakao search when available", async () => {
    const kakaoSearch = vi.fn().mockResolvedValue([MOCK_CANDIDATE]);
    const naverSearch = vi.fn().mockResolvedValue([]);
    const tmapSearch = vi.fn().mockResolvedValue([]);

    const searcher = createSmartLocationSearcher({
      kakaoSearcher: { search: kakaoSearch },
      naverGeocoder: { search: naverSearch },
      tmapSearcher: { search: tmapSearch },
    });

    const results = await searcher.search("교동 119");

    expect(results).toEqual([MOCK_CANDIDATE]);
    expect(kakaoSearch).toHaveBeenCalledWith("교동 119");
    expect(naverSearch).not.toHaveBeenCalled();
  });

  it("falls back to Naver/TMAP if Kakao yields no results", async () => {
    const kakaoSearch = vi.fn().mockResolvedValue([]);
    const naverSearch = vi.fn().mockResolvedValue([]);
    const tmapSearch = vi.fn().mockResolvedValue([MOCK_CANDIDATE]);

    const searcher = createSmartLocationSearcher({
      kakaoSearcher: { search: kakaoSearch },
      naverGeocoder: { search: naverSearch },
      tmapSearcher: { search: tmapSearch },
    });

    const results = await searcher.search("교동 119");

    expect(results).toEqual([MOCK_CANDIDATE]);
    expect(kakaoSearch).toHaveBeenCalledWith("교동 119");
    expect(naverSearch).toHaveBeenCalledWith("교동 119");
    expect(tmapSearch).toHaveBeenCalledWith("교동 119");
  });

  it("returns empty array for queries shorter than 2 chars without calling providers", async () => {
    const kakaoSearch = vi.fn();
    const searcher = createSmartLocationSearcher({
      kakaoSearcher: { search: kakaoSearch },
    });

    const results = await searcher.search("a");
    expect(results).toEqual([]);
    expect(kakaoSearch).not.toHaveBeenCalled();
  });
});
