import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { toKmaGrid } from "../src/lib/geo/kma-grid.ts";

export type FacilityType = "경로당" | "금융기관" | "행정복지센터" | "기타";
export type DaeguDistrict =
  "중구" | "동구" | "서구" | "남구" | "북구" | "수성구" | "달서구" | "달성군";

export type DbfRecord = Readonly<Record<string, string>>;

export interface ShelterProperties {
  readonly id: string;
  readonly name: string;
  readonly gu: DaeguDistrict;
  readonly facility_type: FacilityType;
  readonly is_im_bank: boolean;
  readonly road_address: string;
  readonly kma_nx: number;
  readonly kma_ny: number;
  readonly source_geo_idn: string;
  readonly geocode_result: string;
}

export interface ShelterFeature {
  readonly type: "Feature";
  readonly id: string;
  readonly geometry: {
    readonly type: "Point";
    readonly coordinates: readonly [longitude: number, latitude: number];
  };
  readonly properties: ShelterProperties;
}

export interface ShelterFeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly ShelterFeature[];
}

interface DbfField {
  readonly name: string;
  readonly length: number;
  readonly recordOffset: number;
}

const EXPECTED_FEATURE_COUNT = 950;
const EXPECTED_IM_BANK_COUNT = 100;
const EXPECTED_FACILITY_COUNTS: Readonly<Record<FacilityType, number>> = {
  경로당: 466,
  금융기관: 245,
  행정복지센터: 129,
  기타: 110,
};
const DAEGU_DISTRICTS: readonly DaeguDistrict[] = [
  "중구",
  "동구",
  "서구",
  "남구",
  "북구",
  "수성구",
  "달서구",
  "달성군",
];
const DAEGU_DISTRICT_SET = new Set<string>(DAEGU_DISTRICTS);
const DAEGU_EXTENT = {
  minimumLongitude: 128.33,
  maximumLongitude: 128.78,
  minimumLatitude: 35.58,
  maximumLatitude: 36.02,
} as const;

function readUnsignedInteger(view: DataView, byteOffset: number, byteLength: 2 | 4): number {
  return byteLength === 2 ? view.getUint16(byteOffset, true) : view.getUint32(byteOffset, true);
}

function decodeDbfText(decoder: TextDecoder, bytes: Uint8Array): string {
  return decoder.decode(bytes).replace(/\0+$/u, "").trim();
}

/** Parses the character fields used by the source dBASE III file. */
export function parseDbf(payload: Uint8Array): DbfRecord[] {
  if (payload.byteLength < 33) {
    throw new Error("DBF payload is truncated");
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const recordCount = readUnsignedInteger(view, 4, 4);
  const headerLength = readUnsignedInteger(view, 8, 2);
  const recordLength = readUnsignedInteger(view, 10, 2);

  if (
    headerLength < 33 ||
    headerLength > payload.byteLength ||
    (headerLength - 33) % 32 !== 0 ||
    payload[headerLength - 1] !== 0x0d
  ) {
    throw new Error("DBF header is invalid");
  }

  const requiredPayloadLength = headerLength + recordCount * recordLength;
  if (recordLength < 2 || requiredPayloadLength > payload.byteLength) {
    throw new Error("DBF payload is truncated");
  }

  const decoder = new TextDecoder("euc-kr", { fatal: true });
  const fields: DbfField[] = [];
  const fieldNames = new Set<string>();
  let recordOffset = 1;

  for (let descriptorOffset = 32; descriptorOffset < headerLength - 1; descriptorOffset += 32) {
    const nameBytes = payload.subarray(descriptorOffset, descriptorOffset + 11);
    const nullIndex = nameBytes.indexOf(0);
    const name = decodeDbfText(decoder, nameBytes.subarray(0, nullIndex < 0 ? 11 : nullIndex));
    const fieldType = payload[descriptorOffset + 11];
    const length = payload[descriptorOffset + 16] ?? 0;

    if (!name || fieldNames.has(name) || fieldType !== 0x43 || length === 0) {
      throw new Error("DBF field descriptor is invalid or unsupported");
    }

    fields.push({ name, length, recordOffset });
    fieldNames.add(name);
    recordOffset += length;
  }

  if (fields.length === 0 || recordOffset !== recordLength) {
    throw new Error("DBF record layout is invalid");
  }

  const records: Array<Record<string, string>> = [];
  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const start = headerLength + recordIndex * recordLength;
    const deletionFlag = payload[start];
    if (deletionFlag === 0x2a) continue;
    if (deletionFlag !== 0x20) {
      throw new Error("DBF record status is invalid");
    }

    const record: Record<string, string> = {};
    for (const field of fields) {
      record[field.name] = decodeDbfText(
        decoder,
        payload.subarray(start + field.recordOffset, start + field.recordOffset + field.length),
      );
    }
    records.push(record);
  }

  return records;
}

export function classifyFacility(name: string): FacilityType {
  if (/경로당/u.test(name)) return "경로당";
  if (/행정복지센터|주민센터/u.test(name)) return "행정복지센터";
  if (/은행|농협|신협|새마을금고/u.test(name)) return "금융기관";
  return "기타";
}

export function isImBankShelter(name: string): boolean {
  return /iM|아이엠|DGB|대구은행/iu.test(name);
}

export function parseDaeguDistrict(address: string): DaeguDistrict {
  const normalizedAddress = address.trim().replace(/\s+/gu, " ");
  const match = normalizedAddress.match(
    /^대구(?:광역시)?\s+(중구|동구|서구|남구|북구|수성구|달서구|달성군)(?:\s|$)/u,
  );
  const district = match?.[1];
  if (!district || !DAEGU_DISTRICT_SET.has(district)) {
    throw new Error("Unable to derive a Daegu district");
  }
  return district as DaeguDistrict;
}

function requiredField(record: DbfRecord, field: string): string {
  const value = record[field]?.trim();
  if (!value) throw new Error(`Required DBF field is missing: ${field}`);
  return value;
}

function parseCoordinate(value: string): number {
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate)) {
    throw new Error("DBF contains an invalid WGS84 coordinate");
  }
  return coordinate;
}

function createShelterFeature(record: DbfRecord): ShelterFeature {
  const title = requiredField(record, "title");
  const sourceName = requiredField(record, "쉼터명칭");
  const roadAddress = requiredField(record, "도로명주소");
  const normalizedAddress = requiredField(record, "address");
  const sourceGeoId = requiredField(record, "geoIdn");
  const geocodeResult = requiredField(record, "resultType");

  if (title !== sourceName || roadAddress !== normalizedAddress) {
    throw new Error("DBF duplicate source fields disagree");
  }
  if (!/^\d+$/u.test(sourceGeoId)) {
    throw new Error("DBF geoIdn is invalid");
  }

  const longitude = parseCoordinate(requiredField(record, "x"));
  const latitude = parseCoordinate(requiredField(record, "y"));
  const id = `DG-${sourceGeoId.padStart(4, "0")}`;
  const grid = toKmaGrid(latitude, longitude);

  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [longitude, latitude] },
    properties: {
      id,
      name: title,
      gu: parseDaeguDistrict(roadAddress),
      facility_type: classifyFacility(title),
      is_im_bank: isImBankShelter(title),
      road_address: roadAddress,
      kma_nx: grid.nx,
      kma_ny: grid.ny,
      source_geo_idn: sourceGeoId,
      geocode_result: geocodeResult,
    },
  };
}

export function createShelterFeatureCollection(
  records: readonly DbfRecord[],
): ShelterFeatureCollection {
  const features = records.map(createShelterFeature).sort((left, right) => {
    return Number(left.properties.source_geo_idn) - Number(right.properties.source_geo_idn);
  });
  const collection: ShelterFeatureCollection = { type: "FeatureCollection", features };
  assertShelterInvariants(collection);
  return collection;
}

function assertDaeguPoint(feature: ShelterFeature): void {
  const [longitude, latitude] = feature.geometry.coordinates;
  const inDaeguExtent =
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= DAEGU_EXTENT.minimumLongitude &&
    longitude <= DAEGU_EXTENT.maximumLongitude &&
    latitude >= DAEGU_EXTENT.minimumLatitude &&
    latitude <= DAEGU_EXTENT.maximumLatitude;

  if (feature.geometry.type !== "Point" || !inDaeguExtent) {
    throw new Error("Shelter coordinates must be finite WGS84 points inside Daegu");
  }

  const expectedGrid = toKmaGrid(latitude, longitude);
  if (
    !Number.isInteger(feature.properties.kma_nx) ||
    !Number.isInteger(feature.properties.kma_ny) ||
    feature.properties.kma_nx !== expectedGrid.nx ||
    feature.properties.kma_ny !== expectedGrid.ny
  ) {
    throw new Error("Shelter KMA grid coordinates are invalid");
  }
}

export function assertShelterInvariants(collection: ShelterFeatureCollection): void {
  if (
    collection.type !== "FeatureCollection" ||
    collection.features.length !== EXPECTED_FEATURE_COUNT
  ) {
    throw new Error(`Shelter GeoJSON must contain exactly ${EXPECTED_FEATURE_COUNT} features`);
  }

  const ids = new Set<string>();
  const districts = new Set<string>();
  const facilityCounts: Record<FacilityType, number> = {
    경로당: 0,
    금융기관: 0,
    행정복지센터: 0,
    기타: 0,
  };
  let successfulGeocodes = 0;
  let imBankCount = 0;

  for (const feature of collection.features) {
    const properties = feature.properties;
    if (
      feature.type !== "Feature" ||
      feature.id !== properties.id ||
      !/^DG-\d{4}$/u.test(feature.id) ||
      feature.id !== `DG-${properties.source_geo_idn.padStart(4, "0")}`
    ) {
      throw new Error("Shelter stable ID contract is invalid");
    }
    if (ids.has(feature.id)) throw new Error("Shelter GeoJSON must contain 950 unique shelter IDs");
    ids.add(feature.id);

    if (!properties.name || !properties.road_address) {
      throw new Error("Shelter names and road addresses are required");
    }
    if (!DAEGU_DISTRICT_SET.has(properties.gu)) {
      throw new Error("Shelter district is outside the eight-district source contract");
    }
    districts.add(properties.gu);

    facilityCounts[properties.facility_type] += 1;
    if (properties.is_im_bank) imBankCount += 1;
    if (properties.geocode_result === "SUCC") successfulGeocodes += 1;
    assertDaeguPoint(feature);
  }

  if (ids.size !== EXPECTED_FEATURE_COUNT) {
    throw new Error("Shelter GeoJSON must contain 950 unique shelter IDs");
  }
  if (
    districts.size !== DAEGU_DISTRICTS.length ||
    DAEGU_DISTRICTS.some((district) => !districts.has(district))
  ) {
    throw new Error("Shelter GeoJSON must contain all eight Daegu districts");
  }
  for (const facilityType of Object.keys(EXPECTED_FACILITY_COUNTS) as FacilityType[]) {
    if (facilityCounts[facilityType] !== EXPECTED_FACILITY_COUNTS[facilityType]) {
      throw new Error("Shelter facility type counts do not match the audited source");
    }
  }
  if (imBankCount !== EXPECTED_IM_BANK_COUNT) {
    throw new Error(
      `Shelter GeoJSON must contain exactly ${EXPECTED_IM_BANK_COUNT} iM Bank shelters`,
    );
  }
  if (successfulGeocodes !== EXPECTED_FEATURE_COUNT) {
    throw new Error("Every shelter source record must have a SUCC geocode result");
  }
}

export function serializeShelterFeatureCollection(collection: ShelterFeatureCollection): string {
  assertShelterInvariants(collection);
  const indentedJson = JSON.stringify(collection, null, 2);
  const canonicalJson = indentedJson.replace(
    /"coordinates": \[\n[ \t]+([^,\r\n]+),\n[ \t]+([^\r\n]+)\n[ \t]+\]/gu,
    '"coordinates": [$1, $2]',
  );
  return `${canonicalJson}\n`;
}

type CliMode = "check" | "write";

function parseCliMode(arguments_: readonly string[]): CliMode {
  if (arguments_.length === 1 && arguments_[0] === "--check") return "check";
  if (arguments_.length === 1 && arguments_[0] === "--write") return "write";
  throw new Error("Usage: bun scripts/prepare-shelters.ts --check|--write");
}

export async function runShelterEtl(mode: CliMode): Promise<void> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(scriptDirectory, "..");
  const sourcePath = resolve(projectRoot, "무더위쉼터", "무더위쉼터.dbf");
  const outputPath = resolve(projectRoot, "data", "daegu_shelters.geojson");
  const records = parseDbf(await readFile(sourcePath));
  const collection = createShelterFeatureCollection(records);
  const serialized = serializeShelterFeatureCollection(collection);

  if (mode === "write") {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
    console.log(`Shelter ETL wrote ${collection.features.length} validated features.`);
    return;
  }

  let checkedIn: string;
  try {
    checkedIn = await readFile(outputPath, "utf8");
  } catch {
    throw new Error("Checked-in shelter GeoJSON is missing");
  }
  if (checkedIn !== serialized) {
    throw new Error("Checked-in shelter GeoJSON is out of date");
  }
  console.log(`Shelter ETL verified ${collection.features.length} features.`);
}

async function main(): Promise<void> {
  try {
    await runShelterEtl(parseCliMode(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected shelter ETL error";
    console.error(`Shelter ETL failed: ${message}`);
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) {
  void main();
}
