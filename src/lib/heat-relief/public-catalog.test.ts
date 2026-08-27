import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { findNearbyHeatReliefPoints, parseHeatReliefCatalog } from "./public-catalog";

describe("public heat-relief catalog", () => {
  it("accepts the generated official-facility catalog and keeps its audited counts", () => {
    const catalog = parseHeatReliefCatalog(
      JSON.parse(
        readFileSync(resolve(process.cwd(), "public/data/heat-relief/daegu-points.json"), "utf8"),
      ),
    );

    expect(catalog.summary).toEqual({
      total: 12_950,
      shadeCanopy: 680,
      bench: 10_740,
      pavilion: 1_259,
      parkFacility: 271,
    });
    expect(catalog.points).toHaveLength(12_950);
    expect(catalog.sources.some(({ name }) => name === "대구광역시 공원시설물정보API")).toBe(true);
    expect(catalog.sources.find(({ name }) => name === "전국그늘막쉼터표준데이터")?.url).toBe(
      "https://www.data.go.kr/data/15129447/standard.do",
    );
  });

  it("returns only nearby points, ordered by distance, without mutating source data", () => {
    const points = [
      {
        id: "far",
        type: "BENCH" as const,
        name: "먼 벤치",
        district: null,
        latitude: 35.9,
        longitude: 128.7,
        detail: null,
        address: null,
        source: "OPENSTREETMAP" as const,
        datasetUpdatedAt: null,
      },
      {
        id: "near",
        type: "SHADE_CANOPY" as const,
        name: "가까운 그늘막",
        district: "중구",
        latitude: 35.8701,
        longitude: 128.6001,
        detail: "교통섬",
        address: null,
        source: "DAEGU_DISTRICT_CSV" as const,
        datasetUpdatedAt: "2026-08-01",
      },
      {
        id: "nearest",
        type: "PAVILION" as const,
        name: "가장 가까운 정자",
        district: null,
        latitude: 35.87,
        longitude: 128.6,
        detail: null,
        address: null,
        source: "OPENSTREETMAP" as const,
        datasetUpdatedAt: null,
      },
    ];

    const nearby = findNearbyHeatReliefPoints(points, {
      latitude: 35.87,
      longitude: 128.6,
      radiusM: 500,
    });

    expect(nearby.map(({ id }) => id)).toEqual(["nearest", "near"]);
    expect(nearby[0]?.distanceM).toBe(0);
    expect(points).toHaveLength(3);
  });

  it("scopes a district search to that district's facilities", () => {
    const facility = (
      id: string,
      district: string | null,
      latitude: number,
      longitude: number,
    ) => ({
      id,
      type: "SHADE_CANOPY" as const,
      name: `그늘막 ${id}`,
      district,
      latitude,
      longitude,
      detail: null,
      address: null,
      source: "DAEGU_DISTRICT_CSV" as const,
      datasetUpdatedAt: "2026-08-01",
    });
    const points = [
      facility("neighbour", "중구", 35.8581, 128.6301),
      facility("unlabelled-inside", null, 35.8581, 128.6301),
      facility("unlabelled-outside", null, 35.9, 128.72),
      facility("labelled-far", "수성구", 35.826, 128.674),
    ];

    const nearby = findNearbyHeatReliefPoints(points, {
      latitude: 35.858,
      longitude: 128.63,
      radiusM: 1_000,
      district: "수성구",
    });

    expect(nearby.map(({ id }) => id)).toEqual(["unlabelled-inside", "labelled-far"]);
  });
});
