import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { decodePublicCsv, mergeDaeguShadeCanopies, parseShadeCanopyCsv } from "./shade-canopy-csv";

const header =
  "설치장소명,시도명,시군구명,소재지도로명주소,소재지지번주소,위도,경도,그늘막유형,세부위치,설치년도,전체높이,펼침지름,관리기관명,관리기관전화번호,데이터기준일자,제공기관코드,제공기관명";

describe("shade canopy public CSV normalization", () => {
  it("parses quoted commas and escaped quotes without shifting columns", () => {
    const rows = parseShadeCanopyCsv(
      `${header}\n"시장, 동문",대구광역시,중구,,,35.87,128.60,고정식,"""교통섬"" 앞",2025,3,5,중구청,053-000-0000,2026-08-01,3410000,대구광역시 중구`,
      "NATIONAL_STANDARD_CSV",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "시장, 동문",
      detail: '"교통섬" 앞',
      district: "중구",
      coordinate: { latitude: 35.87, longitude: 128.6 },
    });
  });

  it("replaces a district's national snapshot with the newer district snapshot", () => {
    const national = parseShadeCanopyCsv(
      `${header}\n기존A,대구광역시,달서구,,,35.87,128.60,고정식,,2024,,,달서구청,,2025-01-01,,\n기존B,대구광역시,중구,,,35.88,128.61,고정식,,2024,,,중구청,,2025-01-01,,`,
      "NATIONAL_STANDARD_CSV",
    );
    const dalseo = parseShadeCanopyCsv(
      `${header}\n갱신A,대구광역시,달서구,,,35.871,128.601,스마트그늘막,,2026,,,달서구청,,2026-07-03,,\n신규C,대구광역시,달서구,,,35.872,128.602,고정식,,2026,,,달서구청,,2026-07-03,,`,
      "DAEGU_DISTRICT_CSV",
    );

    const merged = mergeDaeguShadeCanopies(national, [dalseo]);

    expect(merged.map(({ name }) => name).sort()).toEqual(["갱신A", "기존B", "신규C"]);
    expect(merged.find(({ name }) => name === "갱신A")?.source).toBe("DAEGU_DISTRICT_CSV");
  });

  it("decodes and merges the five supplied files into 482 official Daegu canopies", () => {
    const read = (name: string, source: "NATIONAL_STANDARD_CSV" | "DAEGU_DISTRICT_CSV") =>
      parseShadeCanopyCsv(decodePublicCsv(readFileSync(resolve(process.cwd(), name))), source);
    const national = read("전국그늘막쉼터표준데이터.csv", "NATIONAL_STANDARD_CSV");
    const districts = [
      "대구광역시_남구_그늘막쉼터.csv",
      "대구광역시_달서구_그늘막쉼터.csv",
      "대구광역시_달성군_그늘막쉼터.csv",
      "대구광역시_중구_그늘막쉼터.csv",
    ].map((name) => read(name, "DAEGU_DISTRICT_CSV"));

    const merged = mergeDaeguShadeCanopies(national, districts);
    const districtCounts = Object.fromEntries(
      [...new Set(merged.map(({ district }) => district))]
        .sort()
        .map((district) => [
          district,
          merged.filter((entry) => entry.district === district).length,
        ]),
    );

    expect(national.filter(({ city }) => city === "대구광역시")).toHaveLength(475);
    expect(merged).toHaveLength(482);
    expect(districtCounts).toEqual({
      남구: 48,
      달서구: 43,
      달성군: 142,
      북구: 157,
      중구: 92,
    });
    expect(new Set(merged.map(({ sourceFeatureId }) => sourceFeatureId)).size).toBe(482);
  });
});
