import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildVworldBuildingFeature,
  DAEGU_DISTRICT_CODES,
  normalizeVworldBuildingHeight,
  parseShapefilePolygonContent,
  ringsToMultiPolygon,
  scanVworldBuildingDataset,
  vworldDateToIso,
  writeVworldBuildingBundle,
} from "../../../scripts/vworld-building-source.ts";
import { parseVworldBuildingCliOptions } from "../../../scripts/prepare-vworld-buildings.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function shapefilePolygonContent(rings: readonly (readonly (readonly [number, number])[])[]) {
  const points = rings.flat();
  const buffer = Buffer.alloc(44 + rings.length * 4 + points.length * 16);
  buffer.writeInt32LE(5, 0);
  buffer.writeInt32LE(rings.length, 36);
  buffer.writeInt32LE(points.length, 40);
  let pointOffset = 0;
  for (const [partIndex, ring] of rings.entries()) {
    buffer.writeInt32LE(pointOffset, 44 + partIndex * 4);
    pointOffset += ring.length;
  }
  const coordinateOffset = 44 + rings.length * 4;
  for (const [pointIndex, [x, y]] of points.entries()) {
    buffer.writeDoubleLE(x, coordinateOffset + pointIndex * 16);
    buffer.writeDoubleLE(y, coordinateOffset + pointIndex * 16 + 8);
  }
  return buffer;
}

function shapefileSet(contents: readonly Buffer[]) {
  const shpLength = 100 + contents.reduce((total, content) => total + 8 + content.length, 0);
  const shp = Buffer.alloc(shpLength);
  shp.writeInt32BE(9994, 0);
  shp.writeInt32BE(shpLength / 2, 24);
  shp.writeInt32LE(1000, 28);
  shp.writeInt32LE(5, 32);
  const shx = Buffer.alloc(100 + contents.length * 8);
  shp.copy(shx, 0, 0, 100);
  shx.writeInt32BE(shx.length / 2, 24);

  let offset = 100;
  for (const [index, content] of contents.entries()) {
    shp.writeInt32BE(index + 1, offset);
    shp.writeInt32BE(content.length / 2, offset + 4);
    content.copy(shp, offset + 8);
    shx.writeInt32BE(offset / 2, 100 + index * 8);
    shx.writeInt32BE(content.length / 2, 104 + index * 8);
    offset += 8 + content.length;
  }
  return { shp, shx };
}

function dbf(rows: readonly Readonly<Record<string, string>>[]) {
  const fields = [
    { name: "A0", type: "N", length: 9 },
    { name: "A1", type: "C", length: 28 },
    { name: "A16", type: "N", length: 18 },
    { name: "A22", type: "D", length: 8 },
    { name: "A23", type: "C", length: 5 },
    { name: "A26", type: "N", length: 9 },
  ] as const;
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((total, field) => total + field.length, 0);
  const buffer = Buffer.alloc(headerLength + rows.length * recordLength + 1, 0x20);
  buffer[0] = 3;
  buffer.writeUInt32LE(rows.length, 4);
  buffer.writeUInt16LE(headerLength, 8);
  buffer.writeUInt16LE(recordLength, 10);
  fields.forEach((field, index) => {
    const offset = 32 + index * 32;
    buffer.write(field.name, offset, "ascii");
    buffer.write(field.type, offset + 11, "ascii");
    buffer[offset + 16] = field.length;
  });
  buffer[headerLength - 1] = 0x0d;
  rows.forEach((row, rowIndex) => {
    let offset = headerLength + rowIndex * recordLength;
    buffer[offset] = 0x20;
    offset += 1;
    for (const field of fields) {
      const value = row[field.name] ?? "";
      const formatted =
        field.type === "N" ? value.padStart(field.length) : value.padEnd(field.length);
      buffer.write(formatted.slice(0, field.length), offset, "ascii");
      offset += field.length;
    }
  });
  buffer[buffer.length - 1] = 0x1a;
  return buffer;
}

describe("VWorld GIS building source normalization", () => {
  it("requires an explicit check or write mode for the source bundle CLI", () => {
    expect(
      parseVworldBuildingCliOptions([
        "--source-dir",
        "C:/source",
        "--base-name",
        "AL_D010_27_20260809",
        "--check",
      ]),
    ).toEqual({
      sourceDirectory: "C:/source",
      baseName: "AL_D010_27_20260809",
      mode: "check",
    });
    expect(() =>
      parseVworldBuildingCliOptions([
        "--source-dir",
        "C:/source",
        "--base-name",
        "AL_D010_27_20260809",
        "--write",
      ]),
    ).toThrow("--output-dir");
  });

  it("uses a plausible A16 height as verified direct evidence", () => {
    expect(normalizeVworldBuildingHeight("11.1", "4")).toEqual({
      heightM: 11.1,
      heightSource: "VWORLD_GIS_BUILDING_A16",
      heightIsEstimated: false,
      heightEstimationVersion: null,
    });
  });

  it("falls back to A26 floors when A16 is missing or an implausible outlier", () => {
    expect(normalizeVworldBuildingHeight("5035", "1")).toEqual({
      heightM: 3,
      heightSource: "DERIVED_A26_GROUND_FLOORS",
      heightIsEstimated: true,
      heightEstimationVersion: "vworld-a26-3m-v1",
    });
    expect(normalizeVworldBuildingHeight("0", "4")).toMatchObject({ heightM: 12 });
  });

  it("does not invent a height when both A16 and A26 are unavailable", () => {
    expect(normalizeVworldBuildingHeight("0", "0")).toBeNull();
    expect(normalizeVworldBuildingHeight("", "")).toBeNull();
  });

  it("treats Gunwi as part of the current nine-district Daegu boundary", () => {
    expect(DAEGU_DISTRICT_CODES).toHaveLength(9);
    expect(DAEGU_DISTRICT_CODES).toContain("27720");
  });

  it("normalizes the compact VWorld reference date as a KST source timestamp", () => {
    expect(vworldDateToIso("20260806")).toBe("2026-08-06T00:00:00+09:00");
    expect(vworldDateToIso("00000000")).toBeNull();
  });

  it("groups clockwise shells, counter-clockwise holes, and disjoint shells", () => {
    const firstShell = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ] as const;
    const firstHole = [
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
      [2, 2],
    ] as const;
    const secondShell = [
      [20, 20],
      [20, 24],
      [24, 24],
      [24, 20],
      [20, 20],
    ] as const;

    expect(ringsToMultiPolygon([firstShell, firstHole, secondShell])).toEqual({
      type: "MultiPolygon",
      coordinates: [[firstShell, firstHole], [secondShell]],
    });
  });

  it("parses polygon parts from a Shapefile record without losing holes", () => {
    const shell = [
      [200_000, 600_000],
      [200_000, 600_010],
      [200_010, 600_010],
      [200_010, 600_000],
      [200_000, 600_000],
    ] as const;
    const hole = [
      [200_002, 600_002],
      [200_008, 600_002],
      [200_008, 600_008],
      [200_002, 600_008],
      [200_002, 600_002],
    ] as const;

    expect(parseShapefilePolygonContent(shapefilePolygonContent([shell, hole]))).toEqual([
      shell,
      hole,
    ]);
  });

  it("builds a WGS84 import row and keeps direct versus estimated provenance", () => {
    const shell = [
      [200_000, 600_000],
      [200_000, 600_010],
      [200_010, 600_010],
      [200_010, 600_000],
      [200_000, 600_000],
    ] as const;
    const feature = buildVworldBuildingFeature({
      sourceFeatureId: "1981162158352628321700000000",
      districtCode: "27720",
      rawHeight: "0",
      rawGroundFloors: "2",
      rawObservedDate: "20260806",
      rings: [shell],
    });

    expect(feature).toMatchObject({
      sourceFeatureId: "1981162158352628321700000000",
      heightM: 6,
      heightSource: "DERIVED_A26_GROUND_FLOORS",
      heightIsEstimated: true,
      confidence: "DERIVED",
      coverage: "DAEGU_ALL",
      observedAt: "2026-08-06T00:00:00+09:00",
      geometry: { type: "MultiPolygon" },
    });
    expect(feature?.geometry.coordinates[0]?.[0]?.[0]).toEqual([127, 38]);
  });

  it("excludes records outside Daegu or without a trustworthy height", () => {
    const shell = [
      [200_000, 600_000],
      [200_000, 600_010],
      [200_010, 600_010],
      [200_010, 600_000],
      [200_000, 600_000],
    ] as const;
    const common = {
      sourceFeatureId: "feature-1",
      rawHeight: "0",
      rawGroundFloors: "0",
      rawObservedDate: "20260806",
      rings: [shell],
    } as const;

    expect(buildVworldBuildingFeature({ ...common, districtCode: "47110" })).toBeNull();
    expect(buildVworldBuildingFeature({ ...common, districtCode: "27110" })).toBeNull();
  });

  it("streams aligned SHP, SHX, and DBF records into an auditable Daegu dataset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onjung-vworld-"));
    temporaryDirectories.push(directory);
    const baseName = "AL_D010_27_20260809";
    const shell = [
      [322_675, 335_323],
      [322_675, 335_333],
      [322_685, 335_333],
      [322_685, 335_323],
      [322_675, 335_323],
    ] as const;
    const files = shapefileSet([
      shapefilePolygonContent([shell]),
      shapefilePolygonContent([shell]),
      shapefilePolygonContent([shell]),
    ]);
    await Promise.all([
      writeFile(join(directory, `${baseName}.shp`), files.shp),
      writeFile(join(directory, `${baseName}.shx`), files.shx),
      writeFile(
        join(directory, `${baseName}.dbf`),
        dbf([
          {
            A0: "1",
            A1: "building-direct",
            A16: "11.1",
            A22: "20260806",
            A23: "27110",
            A26: "4",
          },
          {
            A0: "2",
            A1: "building-missing",
            A16: "0",
            A22: "20260806",
            A23: "27720",
            A26: "0",
          },
          {
            A0: "3",
            A1: "building-direct",
            A16: "8.5",
            A22: "20260806",
            A23: "27110",
            A26: "3",
          },
        ]),
      ),
      writeFile(
        join(directory, `${baseName}.prj`),
        'PROJCS["Korea_2000_Korea_Central_Belt_2010",AUTHORITY["EPSG","5186"]]',
      ),
    ]);

    const features: unknown[] = [];
    const audit = await scanVworldBuildingDataset({
      sourceDirectory: directory,
      baseName,
      onFeature: (feature) => {
        features.push(feature);
      },
    });

    expect(audit).toMatchObject({
      ok: true,
      sourceCrs: "EPSG:5186",
      recordCount: 3,
      acceptedCount: 2,
      directHeightCount: 2,
      estimatedHeightCount: 0,
      missingHeightCount: 1,
      invalidGeometryCount: 0,
      duplicateSourceIdCount: 0,
      districtCounts: { "27110": 2, "27720": 1 },
    });
    expect(features).toHaveLength(2);
    expect(features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFeatureId: "VWORLD_A0_1_A1_building-direct",
          heightM: 11.1,
        }),
        expect.objectContaining({
          sourceFeatureId: "VWORLD_A0_3_A1_building-direct",
          heightM: 8.5,
        }),
      ]),
    );

    const bundle = await writeVworldBuildingBundle({
      sourceDirectory: directory,
      baseName,
      outputDirectory: join(directory, "prepared"),
    });
    const [manifest, persistedAudit, compressedFeatures] = await Promise.all([
      readFile(bundle.manifestPath, "utf8").then((value) => JSON.parse(value) as unknown),
      readFile(bundle.auditPath, "utf8").then((value) => JSON.parse(value) as unknown),
      readFile(bundle.featurePath),
    ]);
    const persistedFeatures = gunzipSync(compressedFeatures)
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      dataset: "BUILDING",
      version: "vworld-daegu-20260806",
      sourceCrs: "EPSG:5186",
      targetCrs: "EPSG:4326",
      expectedFeatureCount: 2,
      coverage: "DAEGU_ALL",
      confidence: "DERIVED",
    });
    expect(persistedAudit).toMatchObject({ ok: true, acceptedCount: 2 });
    expect(persistedFeatures).toHaveLength(2);
  });
});
