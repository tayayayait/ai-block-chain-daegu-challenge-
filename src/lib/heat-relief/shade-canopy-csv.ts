export type ShadeCanopyCsvSource =
  "NATIONAL_STANDARD_CSV" | "DAEGU_DISTRICT_CSV" | "SUSEONG_SHADE_API" | "DONGGU_SMART_SHADE_API";

export interface OfficialShadeCanopy {
  readonly sourceFeatureId: string;
  readonly source: ShadeCanopyCsvSource;
  readonly name: string;
  readonly city: string;
  readonly district: string;
  readonly roadAddress: string | null;
  readonly lotAddress: string | null;
  readonly coordinate: Readonly<{ latitude: number; longitude: number }>;
  readonly facilityType: string | null;
  readonly detail: string | null;
  readonly installedYear: number | null;
  readonly heightM: number | null;
  readonly widthM: number | null;
  readonly managerName: string | null;
  readonly managerPhone: string | null;
  readonly datasetUpdatedAt: string | null;
  readonly providerCode: string | null;
  readonly providerName: string | null;
  readonly coordinateSource?: "PROVIDED" | "ADDRESS_GEOCODE";
}

const DAEGU_EXTENT = Object.freeze({
  minimumLongitude: 128.33,
  maximumLongitude: 128.78,
  minimumLatitude: 35.58,
  maximumLatitude: 36.02,
});

function parseCsvMatrix(input: string): string[][] {
  const text = input.replace(/^\uFEFF/u, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const finishField = () => {
    row.push(field);
    field = "";
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\n") {
      finishRow();
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) finishRow();
  return rows;
}

function optionalText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function requiredText(value: string | undefined): string {
  return optionalText(value) ?? "";
}

function optionalNumber(value: string | undefined): number | null {
  const normalized = optionalText(value);
  if (normalized === null) return null;
  const parsed = Number(normalized.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalYear(value: string | undefined): number | null {
  const parsed = optionalNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2200
    ? parsed
    : null;
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value.normalize("NFC"))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function inDaeguExtent(latitude: number, longitude: number): boolean {
  return (
    latitude >= DAEGU_EXTENT.minimumLatitude &&
    latitude <= DAEGU_EXTENT.maximumLatitude &&
    longitude >= DAEGU_EXTENT.minimumLongitude &&
    longitude <= DAEGU_EXTENT.maximumLongitude
  );
}

export function decodePublicCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "");
  } catch {
    return new TextDecoder("euc-kr").decode(bytes).replace(/^\uFEFF/u, "");
  }
}

export function parseShadeCanopyCsv(
  text: string,
  source: ShadeCanopyCsvSource,
): OfficialShadeCanopy[] {
  const [headerRow, ...dataRows] = parseCsvMatrix(text);
  if (!headerRow) return [];
  const headerIndex = new Map(
    headerRow.map((heading, index) => [heading.replace(/^\uFEFF/u, "").trim(), index]),
  );
  const get = (row: readonly string[], heading: string): string | undefined => {
    const index = headerIndex.get(heading);
    return index === undefined ? undefined : row[index];
  };

  const result: OfficialShadeCanopy[] = [];
  for (const row of dataRows) {
    const name = requiredText(get(row, "설치장소명"));
    const city = requiredText(get(row, "시도명"));
    const district = requiredText(get(row, "시군구명"));
    const latitude = optionalNumber(get(row, "위도"));
    const longitude = optionalNumber(get(row, "경도"));
    if (
      !name ||
      !city ||
      !district ||
      latitude === null ||
      longitude === null ||
      !inDaeguExtent(latitude, longitude)
    ) {
      continue;
    }
    const roadAddress = optionalText(get(row, "소재지도로명주소"));
    const lotAddress = optionalText(get(row, "소재지지번주소"));
    const detail = optionalText(get(row, "세부위치"));
    const managerName = optionalText(get(row, "관리기관명"));
    const providerCode = optionalText(get(row, "제공기관코드"));
    const identity = [
      district,
      name,
      roadAddress ?? "",
      lotAddress ?? "",
      detail ?? "",
      latitude.toFixed(8),
      longitude.toFixed(8),
      managerName ?? "",
      providerCode ?? "",
    ].join("|");

    result.push({
      sourceFeatureId: `public-shade-${stableHash(identity)}`,
      source,
      name,
      city,
      district,
      roadAddress,
      lotAddress,
      coordinate: { latitude, longitude },
      facilityType: optionalText(get(row, "그늘막유형")),
      detail,
      installedYear: optionalYear(get(row, "설치년도")),
      heightM: optionalNumber(get(row, "전체높이")),
      widthM: optionalNumber(get(row, "펼침지름")),
      managerName,
      managerPhone: optionalText(get(row, "관리기관전화번호")),
      datasetUpdatedAt: optionalText(get(row, "데이터기준일자")),
      providerCode,
      providerName: optionalText(get(row, "제공기관명")),
      coordinateSource: "PROVIDED",
    });
  }
  return result;
}

/**
 * Each district CSV is a newer complete snapshot for that district. Replacing
 * the whole district avoids keeping stale coordinates while preserving two
 * independently listed canopies that happen to share a coordinate.
 */
export function mergeDaeguShadeCanopies(
  nationalRows: readonly OfficialShadeCanopy[],
  districtSnapshots: readonly (readonly OfficialShadeCanopy[])[],
): OfficialShadeCanopy[] {
  const validDistrictSnapshots = districtSnapshots.filter((snapshot) => snapshot.length > 0);
  const replacedDistricts = new Set(
    validDistrictSnapshots.flatMap((snapshot) => [
      ...new Set(snapshot.map(({ district }) => district)),
    ]),
  );
  const merged = [
    ...nationalRows.filter(
      ({ city, district }) => city === "대구광역시" && !replacedDistricts.has(district),
    ),
    ...validDistrictSnapshots.flat().filter(({ city }) => city === "대구광역시"),
  ];
  return merged.sort(
    (left, right) =>
      left.district.localeCompare(right.district, "ko") ||
      left.name.localeCompare(right.name, "ko") ||
      left.coordinate.latitude - right.coordinate.latitude ||
      left.coordinate.longitude - right.coordinate.longitude,
  );
}
