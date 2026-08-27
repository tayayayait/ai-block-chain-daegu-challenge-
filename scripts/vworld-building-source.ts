import { createWriteStream } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { createGzip } from "node:zlib";

import { transformPositionToWgs84 } from "./import-spatial-data.ts";

export type VworldPosition = readonly [x: number, y: number];

export const DAEGU_DISTRICT_CODES = [
  "27110",
  "27140",
  "27170",
  "27200",
  "27230",
  "27260",
  "27290",
  "27710",
  "27720",
] as const;

const DIRECT_HEIGHT_MIN_M = 1;
const DIRECT_HEIGHT_MAX_M = 200;
const FLOOR_HEIGHT_M = 3;
const FLOOR_COUNT_MAX = 100;

function strictNumber(raw: string): number | null {
  const value = raw.trim();
  if (!/^-?\d+(?:\.\d+)?$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeVworldBuildingHeight(
  _rawHeight: string,
  _rawGroundFloors: string,
): Readonly<{
  heightM: number;
  heightSource: string;
  heightIsEstimated: boolean;
  heightEstimationVersion: string | null;
}> | null {
  const directHeight = strictNumber(_rawHeight);
  if (
    directHeight !== null &&
    directHeight >= DIRECT_HEIGHT_MIN_M &&
    directHeight <= DIRECT_HEIGHT_MAX_M
  ) {
    return {
      heightM: directHeight,
      heightSource: "VWORLD_GIS_BUILDING_A16",
      heightIsEstimated: false,
      heightEstimationVersion: null,
    };
  }

  const floorCount = strictNumber(_rawGroundFloors);
  if (
    floorCount === null ||
    !Number.isInteger(floorCount) ||
    floorCount < 1 ||
    floorCount > FLOOR_COUNT_MAX
  ) {
    return null;
  }
  return {
    heightM: floorCount * FLOOR_HEIGHT_M,
    heightSource: "DERIVED_A26_GROUND_FLOORS",
    heightIsEstimated: true,
    heightEstimationVersion: "vworld-a26-3m-v1",
  };
}

export function vworldDateToIso(_rawDate: string): string | null {
  const matched = /^(\d{4})(\d{2})(\d{2})$/u.exec(_rawDate.trim());
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${matched[1]}-${matched[2]}-${matched[3]}T00:00:00+09:00`;
}

function signedArea(ring: readonly VworldPosition[]): number {
  let area = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const previous = ring[index - 1]!;
    const current = ring[index]!;
    area += previous[0] * current[1] - current[0] * previous[1];
  }
  return area / 2;
}

function pointInRing(point: VworldPosition, ring: readonly VworldPosition[]): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const left = ring[current]!;
    const right = ring[previous]!;
    const crosses =
      left[1] > point[1] !== right[1] > point[1] &&
      point[0] < ((right[0] - left[0]) * (point[1] - left[1])) / (right[1] - left[1]) + left[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function validClosedRing(ring: readonly VworldPosition[]): boolean {
  const first = ring[0];
  const last = ring.at(-1);
  return (
    ring.length >= 4 &&
    first !== undefined &&
    last !== undefined &&
    first[0] === last[0] &&
    first[1] === last[1] &&
    ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) &&
    signedArea(ring) !== 0
  );
}

export function ringsToMultiPolygon(_rings: readonly (readonly VworldPosition[])[]): Readonly<{
  type: "MultiPolygon";
  coordinates: readonly (readonly (readonly VworldPosition[])[])[];
}> {
  if (_rings.length === 0 || _rings.some((ring) => !validClosedRing(ring))) {
    throw new RangeError("INVALID_SHAPEFILE_RINGS");
  }

  const shells = _rings
    .map((ring, sourceIndex) => ({ ring, sourceIndex, area: signedArea(ring) }))
    .filter((entry) => entry.area < 0)
    .map((entry) => ({ ...entry, rings: [entry.ring] as (readonly VworldPosition[])[] }));
  if (shells.length === 0) throw new RangeError("SHAPEFILE_SHELL_REQUIRED");

  for (const hole of _rings
    .map((ring, sourceIndex) => ({ ring, sourceIndex, area: signedArea(ring) }))
    .filter((entry) => entry.area > 0)) {
    const point = hole.ring[0]!;
    const container = shells
      .filter((shell) => pointInRing(point, shell.ring))
      .sort((left, right) => Math.abs(left.area) - Math.abs(right.area))[0];
    if (!container) throw new RangeError("ORPHAN_SHAPEFILE_HOLE");
    container.rings.push(hole.ring);
  }

  return {
    type: "MultiPolygon",
    coordinates: shells
      .sort((left, right) => left.sourceIndex - right.sourceIndex)
      .map((shell) => shell.rings),
  };
}

export function parseShapefilePolygonContent(
  content: Buffer,
): readonly (readonly VworldPosition[])[] {
  if (content.length < 44 || content.readInt32LE(0) !== 5) {
    throw new RangeError("INVALID_SHAPEFILE_POLYGON");
  }
  const partCount = content.readInt32LE(36);
  const pointCount = content.readInt32LE(40);
  if (partCount < 1 || pointCount < 4) throw new RangeError("EMPTY_SHAPEFILE_POLYGON");
  const partOffset = 44;
  const coordinateOffset = partOffset + partCount * 4;
  if (coordinateOffset + pointCount * 16 !== content.length) {
    throw new RangeError("INVALID_SHAPEFILE_POLYGON_LENGTH");
  }

  const starts = Array.from({ length: partCount }, (_, index) =>
    content.readInt32LE(partOffset + index * 4),
  );
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? pointCount;
    if (start < 0 || end > pointCount || end - start < 4) {
      throw new RangeError("INVALID_SHAPEFILE_PART");
    }
    return Array.from({ length: end - start }, (_, pointIndex) => {
      const offset = coordinateOffset + (start + pointIndex) * 16;
      const position = [content.readDoubleLE(offset), content.readDoubleLE(offset + 8)] as const;
      if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) {
        throw new RangeError("INVALID_SHAPEFILE_POSITION");
      }
      return position;
    });
  });
}

export interface VworldBuildingFeatureInput {
  readonly sourceFeatureId: string;
  readonly districtCode: string;
  readonly rawHeight: string;
  readonly rawGroundFloors: string;
  readonly rawObservedDate: string;
  readonly rings: readonly (readonly VworldPosition[])[];
}

export interface VworldBuildingFeature {
  readonly sourceFeatureId: string;
  readonly geometry: Readonly<{
    type: "MultiPolygon";
    coordinates: readonly (readonly (readonly VworldPosition[])[])[];
  }>;
  readonly heightM: number;
  readonly heightSource: string;
  readonly heightIsEstimated: boolean;
  readonly heightEstimationVersion: string | null;
  readonly observedAt: string | null;
  readonly confidence: "VERIFIED_SOURCE" | "DERIVED";
  readonly coverage: "DAEGU_ALL";
  readonly unknownReason: string | null;
}

export function buildVworldBuildingFeature(
  input: VworldBuildingFeatureInput,
): VworldBuildingFeature | null {
  const sourceFeatureId = input.sourceFeatureId.trim();
  if (!sourceFeatureId || !DAEGU_DISTRICT_CODES.includes(input.districtCode as never)) return null;
  const height = normalizeVworldBuildingHeight(input.rawHeight, input.rawGroundFloors);
  if (!height) return null;

  const sourceGeometry = ringsToMultiPolygon(input.rings);
  return {
    sourceFeatureId,
    geometry: {
      type: "MultiPolygon",
      coordinates: sourceGeometry.coordinates.map((polygon) =>
        polygon.map((ring) =>
          ring.map(
            (position) =>
              transformPositionToWgs84([position[0], position[1]], "EPSG:5186") as VworldPosition,
          ),
        ),
      ),
    },
    ...height,
    observedAt: vworldDateToIso(input.rawObservedDate),
    confidence: height.heightIsEstimated ? "DERIVED" : "VERIFIED_SOURCE",
    coverage: "DAEGU_ALL",
    unknownReason: height.heightIsEstimated
      ? "A16 높이 누락 또는 이상치로 A26 지상층수에 3m를 곱해 추정함"
      : null,
  };
}

interface DbfField {
  readonly position: number;
  readonly length: number;
}

interface DbfLayout {
  readonly recordCount: number;
  readonly headerLength: number;
  readonly recordLength: number;
  readonly fields: Readonly<Record<string, DbfField>>;
}

function parseDbfLayout(header: Buffer): DbfLayout {
  if (header.length < 33 || header[0] !== 3) throw new RangeError("UNSUPPORTED_VWORLD_DBF");
  const recordCount = header.readUInt32LE(4);
  const headerLength = header.readUInt16LE(8);
  const recordLength = header.readUInt16LE(10);
  if (header.length !== headerLength || header[headerLength - 1] !== 0x0d) {
    throw new RangeError("INVALID_VWORLD_DBF_HEADER");
  }
  let position = 1;
  const fields: Record<string, DbfField> = {};
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    const name = header
      .subarray(offset, offset + 11)
      .toString("ascii")
      .replace(/\0.*$/u, "")
      .trim();
    const length = header[offset + 16] ?? 0;
    if (!name || length < 1) throw new RangeError("INVALID_VWORLD_DBF_FIELD");
    fields[name] = { position, length };
    position += length;
  }
  if (position !== recordLength) throw new RangeError("INVALID_VWORLD_DBF_RECORD_LENGTH");
  for (const required of ["A1", "A16", "A22", "A23", "A26"]) {
    if (!fields[required]) throw new RangeError(`MISSING_VWORLD_DBF_FIELD_${required}`);
  }
  return { recordCount, headerLength, recordLength, fields };
}

function dbfText(buffer: Buffer, recordOffset: number, field: DbfField): string {
  return buffer
    .subarray(recordOffset + field.position, recordOffset + field.position + field.length)
    .toString("ascii")
    .replace(/\0+$/u, "")
    .trim();
}

function validateShapefileHeader(buffer: Buffer, expectedLength: number, label: string): void {
  if (
    buffer.length < 100 ||
    buffer.readInt32BE(0) !== 9994 ||
    buffer.readInt32BE(24) * 2 !== expectedLength ||
    buffer.readInt32LE(28) !== 1000 ||
    buffer.readInt32LE(32) !== 5
  ) {
    throw new RangeError(`INVALID_VWORLD_${label}_HEADER`);
  }
}

export interface VworldBuildingAudit {
  readonly schemaVersion: 1;
  readonly ok: boolean;
  readonly sourceCrs: "EPSG:5186";
  readonly recordCount: number;
  readonly acceptedCount: number;
  readonly directHeightCount: number;
  readonly estimatedHeightCount: number;
  readonly missingHeightCount: number;
  readonly outsideDaeguCount: number;
  readonly invalidGeometryCount: number;
  readonly duplicateSourceIdCount: number;
  readonly deletedRecordCount: number;
  readonly districtCounts: Readonly<Record<string, number>>;
  readonly sourceDateCounts: Readonly<Record<string, number>>;
}

export interface ScanVworldBuildingDatasetOptions {
  readonly sourceDirectory: string;
  readonly baseName: string;
  readonly onFeature?: (feature: VworldBuildingFeature) => void | Promise<void>;
}

export async function scanVworldBuildingDataset(
  options: ScanVworldBuildingDatasetOptions,
): Promise<VworldBuildingAudit> {
  if (!/^[A-Za-z0-9_-]+$/u.test(options.baseName)) {
    throw new RangeError("INVALID_VWORLD_BASE_NAME");
  }
  const sourceDirectory = resolve(options.sourceDirectory);
  const sourcePath = (extension: string) =>
    resolve(sourceDirectory, `${options.baseName}.${extension}`);
  const [shp, shx, projection] = await Promise.all([
    readFile(sourcePath("shp")),
    readFile(sourcePath("shx")),
    readFile(sourcePath("prj"), "utf8"),
  ]);
  validateShapefileHeader(shp, shp.length, "SHP");
  validateShapefileHeader(shx, shx.length, "SHX");
  if (!/AUTHORITY\["EPSG","5186"\]/u.test(projection)) {
    throw new RangeError("VWORLD_SOURCE_CRS_MUST_BE_EPSG_5186");
  }
  if ((shx.length - 100) % 8 !== 0) throw new RangeError("INVALID_VWORLD_SHX_LENGTH");
  const shapefileRecordCount = (shx.length - 100) / 8;

  const dbfHandle = await open(sourcePath("dbf"), "r");
  try {
    const prefix = Buffer.alloc(32);
    const prefixRead = await dbfHandle.read(prefix, 0, prefix.length, 0);
    if (prefixRead.bytesRead !== prefix.length) throw new RangeError("TRUNCATED_VWORLD_DBF");
    const headerLength = prefix.readUInt16LE(8);
    const header = Buffer.alloc(headerLength);
    const headerRead = await dbfHandle.read(header, 0, header.length, 0);
    if (headerRead.bytesRead !== header.length) throw new RangeError("TRUNCATED_VWORLD_DBF");
    const layout = parseDbfLayout(header);
    if (layout.recordCount !== shapefileRecordCount) {
      throw new RangeError("VWORLD_SHP_DBF_RECORD_COUNT_MISMATCH");
    }

    const fields = layout.fields;
    const districtSet = new Set<string>(DAEGU_DISTRICT_CODES);
    const sourceIds = new Set<string>();
    const districtCounts: Record<string, number> = {};
    const sourceDateCounts: Record<string, number> = {};
    let acceptedCount = 0;
    let directHeightCount = 0;
    let estimatedHeightCount = 0;
    let missingHeightCount = 0;
    let outsideDaeguCount = 0;
    let invalidGeometryCount = 0;
    let duplicateSourceIdCount = 0;
    let deletedRecordCount = 0;

    const recordsPerBatch = 2_048;
    const batch = Buffer.alloc(layout.recordLength * recordsPerBatch);
    for (let firstRecord = 0; firstRecord < layout.recordCount; firstRecord += recordsPerBatch) {
      const recordsInBatch = Math.min(recordsPerBatch, layout.recordCount - firstRecord);
      const byteLength = recordsInBatch * layout.recordLength;
      const result = await dbfHandle.read(
        batch,
        0,
        byteLength,
        layout.headerLength + firstRecord * layout.recordLength,
      );
      if (result.bytesRead !== byteLength) throw new RangeError("TRUNCATED_VWORLD_DBF_RECORDS");

      for (let batchIndex = 0; batchIndex < recordsInBatch; batchIndex += 1) {
        const recordIndex = firstRecord + batchIndex;
        const recordOffset = batchIndex * layout.recordLength;
        if (batch[recordOffset] === 0x2a) {
          deletedRecordCount += 1;
          continue;
        }
        const districtCode = dbfText(batch, recordOffset, fields["A23"]!);
        districtCounts[districtCode] = (districtCounts[districtCode] ?? 0) + 1;
        const rawObservedDate = dbfText(batch, recordOffset, fields["A22"]!);
        sourceDateCounts[rawObservedDate] = (sourceDateCounts[rawObservedDate] ?? 0) + 1;
        const rawHeight = dbfText(batch, recordOffset, fields["A16"]!);
        const rawGroundFloors = dbfText(batch, recordOffset, fields["A26"]!);
        const height = normalizeVworldBuildingHeight(rawHeight, rawGroundFloors);
        if (!districtSet.has(districtCode)) outsideDaeguCount += 1;
        else if (!height) missingHeightCount += 1;

        const indexOffset = 100 + recordIndex * 8;
        const shapeRecordOffset = shx.readInt32BE(indexOffset) * 2;
        const contentLength = shx.readInt32BE(indexOffset + 4) * 2;
        let rings: readonly (readonly VworldPosition[])[];
        try {
          if (
            shapeRecordOffset < 100 ||
            shapeRecordOffset + 8 + contentLength > shp.length ||
            shp.readInt32BE(shapeRecordOffset) !== recordIndex + 1 ||
            shp.readInt32BE(shapeRecordOffset + 4) * 2 !== contentLength
          ) {
            throw new RangeError("INVALID_VWORLD_SHAPE_INDEX");
          }
          rings = parseShapefilePolygonContent(
            shp.subarray(shapeRecordOffset + 8, shapeRecordOffset + 8 + contentLength),
          );
        } catch {
          invalidGeometryCount += 1;
          continue;
        }

        if (!height || !districtSet.has(districtCode)) continue;
        const sourceShapeId = fields["A0"] ? dbfText(batch, recordOffset, fields["A0"]!) : "";
        const gisBuildingId = dbfText(batch, recordOffset, fields["A1"]!);
        const sourceFeatureId =
          sourceShapeId && gisBuildingId
            ? `VWORLD_A0_${sourceShapeId}_A1_${gisBuildingId}`
            : sourceShapeId
              ? `VWORLD_A0_${sourceShapeId}`
              : gisBuildingId;
        let feature: VworldBuildingFeature | null;
        try {
          feature = buildVworldBuildingFeature({
            sourceFeatureId,
            districtCode,
            rawHeight,
            rawGroundFloors,
            rawObservedDate,
            rings,
          });
        } catch {
          invalidGeometryCount += 1;
          continue;
        }
        if (!feature) continue;
        if (sourceIds.has(feature.sourceFeatureId)) {
          duplicateSourceIdCount += 1;
          continue;
        }
        sourceIds.add(feature.sourceFeatureId);
        acceptedCount += 1;
        if (feature.heightIsEstimated) estimatedHeightCount += 1;
        else directHeightCount += 1;
        await options.onFeature?.(feature);
      }
    }

    return {
      schemaVersion: 1,
      ok:
        invalidGeometryCount === 0 &&
        duplicateSourceIdCount === 0 &&
        outsideDaeguCount === 0 &&
        deletedRecordCount === 0 &&
        acceptedCount + missingHeightCount === layout.recordCount,
      sourceCrs: "EPSG:5186",
      recordCount: layout.recordCount,
      acceptedCount,
      directHeightCount,
      estimatedHeightCount,
      missingHeightCount,
      outsideDaeguCount,
      invalidGeometryCount,
      duplicateSourceIdCount,
      deletedRecordCount,
      districtCounts,
      sourceDateCounts,
    };
  } finally {
    await dbfHandle.close();
  }
}

export interface VworldBuildingBundleManifest {
  readonly schemaVersion: 1;
  readonly dataset: "BUILDING";
  readonly version: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly licenseCode: string;
  readonly attribution: string;
  readonly sourceCrs: "EPSG:5186";
  readonly targetCrs: "EPSG:4326";
  readonly datasetUpdatedAt: string;
  readonly coverage: "DAEGU_ALL";
  readonly confidence: "DERIVED";
  readonly unknownReason: string;
  readonly expectedFeatureCount: number;
  readonly featureFormat: "NDJSON_GZIP";
  readonly rules: Readonly<{
    directHeightField: "A16";
    floorCountField: "A26";
    floorHeightM: 3;
    directHeightRangeM: readonly [1, 200];
    heightEstimationVersion: "vworld-a26-3m-v1";
  }>;
}

export interface WriteVworldBuildingBundleOptions extends ScanVworldBuildingDatasetOptions {
  readonly outputDirectory: string;
}

export interface VworldBuildingBundle {
  readonly featurePath: string;
  readonly manifestPath: string;
  readonly auditPath: string;
  readonly manifest: VworldBuildingBundleManifest;
  readonly audit: VworldBuildingAudit;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const partialPath = `${path}.partial`;
  try {
    await writeFile(partialPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(partialPath, path);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
}

export async function writeVworldBuildingBundle(
  options: WriteVworldBuildingBundleOptions,
): Promise<VworldBuildingBundle> {
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const featurePath = resolve(outputDirectory, "vworld-daegu-buildings.ndjson.gz");
  const manifestPath = resolve(outputDirectory, "vworld-daegu-buildings.manifest.json");
  const auditPath = resolve(outputDirectory, "vworld-daegu-buildings.audit.json");
  if (
    (await pathExists(featurePath)) ||
    (await pathExists(manifestPath)) ||
    (await pathExists(auditPath))
  ) {
    throw new Error("VWORLD_OUTPUT_ALREADY_EXISTS");
  }

  const partialFeaturePath = `${featurePath}.partial`;
  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(partialFeaturePath, { flags: "wx" });
  gzip.pipe(output);
  let audit: VworldBuildingAudit;
  try {
    audit = await scanVworldBuildingDataset({
      sourceDirectory: options.sourceDirectory,
      baseName: options.baseName,
      onFeature: async (feature) => {
        if (!gzip.write(`${JSON.stringify(feature)}\n`)) await once(gzip, "drain");
        await options.onFeature?.(feature);
      },
    });
    gzip.end();
    await finished(output);
    if (!audit.ok) throw new Error("VWORLD_SOURCE_AUDIT_FAILED");
    await rename(partialFeaturePath, featurePath);
  } catch (error) {
    gzip.destroy();
    output.destroy();
    await rm(partialFeaturePath, { force: true });
    throw error;
  }

  const sourceDate = Object.entries(audit.sourceDateCounts).sort(
    ([leftDate, leftCount], [rightDate, rightCount]) =>
      rightCount - leftCount || leftDate.localeCompare(rightDate),
  )[0]?.[0];
  const datasetUpdatedAt = sourceDate ? vworldDateToIso(sourceDate) : null;
  if (!sourceDate || !datasetUpdatedAt) {
    await rm(featurePath, { force: true });
    throw new Error("VWORLD_SOURCE_DATE_UNAVAILABLE");
  }
  const manifest: VworldBuildingBundleManifest = {
    schemaVersion: 1,
    dataset: "BUILDING",
    version: `vworld-daegu-${sourceDate}`,
    sourceName: "국토교통부 GIS건물통합정보",
    sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=18",
    licenseCode: "PUBLIC_DATA_UNRESTRICTED",
    attribution: "국토교통부·VWorld",
    sourceCrs: "EPSG:5186",
    targetCrs: "EPSG:4326",
    datasetUpdatedAt,
    coverage: "DAEGU_ALL",
    confidence: "DERIVED",
    unknownReason: `${audit.missingHeightCount.toLocaleString("en-US")}개 건물은 A16 높이와 A26 지상층수가 모두 없어 그림자 계산에서 제외됨`,
    expectedFeatureCount: audit.acceptedCount,
    featureFormat: "NDJSON_GZIP",
    rules: {
      directHeightField: "A16",
      floorCountField: "A26",
      floorHeightM: 3,
      directHeightRangeM: [1, 200],
      heightEstimationVersion: "vworld-a26-3m-v1",
    },
  };

  try {
    await writeJsonAtomically(manifestPath, manifest);
    await writeJsonAtomically(auditPath, audit);
  } catch (error) {
    await Promise.all([
      rm(featurePath, { force: true }),
      rm(manifestPath, { force: true }),
      rm(auditPath, { force: true }),
    ]);
    throw error;
  }
  return { featurePath, manifestPath, auditPath, manifest, audit };
}
