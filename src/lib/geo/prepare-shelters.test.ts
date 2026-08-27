import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertShelterInvariants,
  classifyFacility,
  createShelterFeatureCollection,
  isImBankShelter,
  parseDaeguDistrict,
  parseDbf,
  serializeShelterFeatureCollection,
  type ShelterFeatureCollection,
} from "../../../scripts/prepare-shelters";

const root = process.cwd();
const sourcePath = resolve(root, "무더위쉼터", "무더위쉼터.dbf");
const outputPath = resolve(root, "data", "daegu_shelters.geojson");
const source = readFileSync(sourcePath);

describe("shelter derivation rules", () => {
  it.each([
    ["은행 안 경로당", "경로당"],
    ["OO동 행정복지센터", "행정복지센터"],
    ["OO 주민센터", "행정복지센터"],
    ["대구은행 본점", "금융기관"],
    ["OO농협", "금융기관"],
    ["OO신협", "금융기관"],
    ["OO새마을금고", "금융기관"],
    ["복지회관", "기타"],
  ] as const)("classifies %s as %s using the documented precedence", (name, expected) => {
    expect(classifyFacility(name)).toBe(expected);
  });

  it.each(["iM뱅크", "아이엠뱅크", "DGB대구은행", "대구은행"])(
    "identifies an iM Bank spelling: %s",
    (name) => {
      expect(isImBankShelter(name)).toBe(true);
    },
  );

  it("does not classify an unrelated bank as iM Bank", () => {
    expect(isImBankShelter("국민은행")).toBe(false);
  });

  it.each([
    ["대구광역시 달서구 달구벌대로 1", "달서구"],
    [" 대구 달성군 가창로 1 ", "달성군"],
  ])("parses a Daegu district from %s", (address, expected) => {
    expect(parseDaeguDistrict(address)).toBe(expected);
  });

  it("rejects an address outside the eight-district source contract", () => {
    expect(() => parseDaeguDistrict("서울특별시 중구 세종대로 1")).toThrow(
      "Unable to derive a Daegu district",
    );
  });
});

describe("EUC-KR DBF parsing", () => {
  it("reads all 950 active rows and the required source fields", () => {
    const rows = parseDbf(source);

    expect(rows).toHaveLength(950);
    expect(Object.keys(rows[0] ?? {})).toEqual([
      "title",
      "도로명주소",
      "지번주소",
      "address",
      "geoIdn",
      "쉼터명칭",
      "resultType",
      "y",
      "x",
    ]);
    expect(rows.every((row) => row["resultType"] === "SUCC")).toBe(true);
  });

  it("rejects a truncated DBF instead of returning partial records", () => {
    expect(() => parseDbf(source.subarray(0, source.length - 100))).toThrow(
      "DBF payload is truncated",
    );
  });
});

describe("Daegu shelter GeoJSON ETL", () => {
  const rows = parseDbf(source);
  const collection = createShelterFeatureCollection(rows);

  it("produces exactly 950 deterministic GeoJSON Point features", () => {
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(950);
    expect(collection.features[0]?.id).toBe("DG-0002");
    expect(collection.features.at(-1)?.id).toBe("DG-0951");
    expect(new Set(collection.features.map((feature) => feature.id)).size).toBe(950);
    expect(collection.features.every((feature) => feature.geometry.type === "Point")).toBe(true);
  });

  it("uses DBF x only as longitude and y only as latitude", () => {
    const sourceById = new Map(rows.map((row) => [`DG-${row["geoIdn"]?.padStart(4, "0")}`, row]));

    for (const feature of collection.features) {
      const row = sourceById.get(feature.id);
      expect(row).toBeDefined();
      expect(feature.geometry.coordinates).toEqual([Number(row?.["x"]), Number(row?.["y"])]);
    }
  });

  it("matches all audited dataset invariants", () => {
    expect(() => assertShelterInvariants(collection)).not.toThrow();

    const typeCounts = collection.features.reduce<Record<string, number>>((counts, feature) => {
      const type = feature.properties.facility_type;
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    }, {});
    expect(typeCounts).toEqual({ 금융기관: 245, 기타: 110, 행정복지센터: 129, 경로당: 466 });
    expect(collection.features.filter((feature) => feature.properties.is_im_bank)).toHaveLength(
      100,
    );
    expect(new Set(collection.features.map((feature) => feature.properties.gu))).toEqual(
      new Set(["중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군"]),
    );
    expect(
      collection.features.every((feature) => feature.properties.geocode_result === "SUCC"),
    ).toBe(true);
  });

  it("stores finite WGS84 coordinates inside the Daegu extent and integer KMA cells", () => {
    for (const feature of collection.features) {
      const [longitude, latitude] = feature.geometry.coordinates;
      expect(Number.isFinite(longitude)).toBe(true);
      expect(Number.isFinite(latitude)).toBe(true);
      expect(longitude).toBeGreaterThanOrEqual(128.33);
      expect(longitude).toBeLessThanOrEqual(128.78);
      expect(latitude).toBeGreaterThanOrEqual(35.58);
      expect(latitude).toBeLessThanOrEqual(36.02);
      expect(Number.isInteger(feature.properties.kma_nx)).toBe(true);
      expect(Number.isInteger(feature.properties.kma_ny)).toBe(true);
    }
  });

  it("fails closed when an invariant is violated", () => {
    const duplicateFeatures = collection.features.map((feature) => structuredClone(feature));
    const firstFeature = duplicateFeatures[0];
    expect(firstFeature).toBeDefined();
    if (!firstFeature) throw new Error("Fixture must contain a feature");
    duplicateFeatures[1] = structuredClone(firstFeature);
    const duplicate: ShelterFeatureCollection = {
      type: "FeatureCollection",
      features: duplicateFeatures,
    };

    expect(() => assertShelterInvariants(duplicate)).toThrow("unique shelter IDs");
  });

  it("serializes coordinate pairs in the repository's canonical JSON format", () => {
    const serialized = serializeShelterFeatureCollection(collection);

    expect(serialized.match(/"coordinates": \[[^\r\n]+\]/gu)).toHaveLength(950);
  });

  it("keeps the checked-in GeoJSON byte-for-byte reproducible", () => {
    const checkedIn = readFileSync(outputPath, "utf8");

    expect(checkedIn === serializeShelterFeatureCollection(collection)).toBe(true);
  });
});
