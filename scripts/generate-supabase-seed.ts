import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computeHri, type HriInput, type HriResult } from "../src/lib/risk/hri.ts";
import type { RiskLevel } from "../src/lib/domain-types.ts";
import { assertShelterInvariants, type ShelterFeatureCollection } from "./prepare-shelters.ts";

type DemoCheckinState = "NONE" | "UNVERIFIED" | "VERIFIED";
type DemoSex = "FEMALE" | "MALE" | "OTHER" | "UNDISCLOSED";
type MedicationRiskTier = "HIGH" | "MID";

interface DemoMedication {
  readonly id: string;
  readonly productName: string;
  readonly ingredientName: string;
  readonly heatClass: string;
  readonly riskTier: MedicationRiskTier;
}

interface DemoWeather {
  readonly airTemperatureC: number;
  readonly humidityPct: number;
}

interface DemoSubjectDefinition {
  readonly stableId: string;
  readonly id: string;
  readonly name: string;
  readonly birthYear: number;
  readonly sex: DemoSex;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly kmaNx: number;
  readonly kmaNy: number;
  readonly seniorMode: boolean;
  readonly medRegistered: boolean;
  readonly medications: readonly DemoMedication[];
  readonly checkinState: DemoCheckinState;
  readonly hriInput: HriInput;
  readonly expectedLevel: RiskLevel;
  readonly weather: DemoWeather;
}

export interface DemoSubjectFixture extends DemoSubjectDefinition {
  readonly risk: HriResult;
}

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_PROFILE_ID = "00000000-0000-4000-8000-000000000101";
const CARE_WORKER_PROFILE_ID = "00000000-0000-4000-8000-000000000102";
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";
const FIXTURE_CREATED_AT = "2026-08-20T00:00:00.000Z";
const WEATHER_OBSERVED_AT = "2026-08-22T06:00:00.000Z";
const WEATHER_COLLECTED_AT = "2026-08-22T06:05:00.000Z";
const WEATHER_EXPIRES_AT = "2026-08-22T07:00:00.000Z";
const RISK_BUCKET_START = "2026-08-22T06:00:00.000Z";
const RISK_COMPUTED_AT = "2026-08-22T06:10:00.000Z";
const CHECKED_IN_AT = "2026-08-22T05:30:00.000Z";
// secret-scan: allow-next-line -- test-fixture
const DEMO_PASSWORD = "onjung-local-demo-only";

const SUBJECT_DEFINITIONS: readonly DemoSubjectDefinition[] = [
  {
    stableId: "s-001",
    id: "10000000-0000-4000-8000-000000000001",
    name: "가상 대상자 L0",
    birthYear: 1960,
    sex: "FEMALE",
    address: "가상 주소 · 대구 수성구 데모 1",
    latitude: 35.8281,
    longitude: 128.6321,
    kmaNx: 89,
    kmaNy: 90,
    seniorMode: false,
    medRegistered: true,
    medications: [],
    checkinState: "NONE",
    hriInput: {
      feelsLikeC: 30,
      heatAdvisory: "NONE",
      tropicalNightStreak: 0,
      medHigh: 0,
      medMid: 0,
      medRegistered: true,
      age: 66,
      livesAlone: false,
      chronicDisease: false,
      noCooling: false,
      shelterCheckInVerified24h: false,
    },
    expectedLevel: "L0",
    weather: { airTemperatureC: 29.2, humidityPct: 52 },
  },
  {
    stableId: "s-002",
    id: "10000000-0000-4000-8000-000000000002",
    name: "가상 대상자 L1",
    birthYear: 1950,
    sex: "MALE",
    address: "가상 주소 · 대구 수성구 데모 2",
    latitude: 35.8404,
    longitude: 128.6215,
    kmaNx: 89,
    kmaNy: 90,
    seniorMode: true,
    medRegistered: false,
    medications: [],
    checkinState: "NONE",
    hriInput: {
      feelsLikeC: 31,
      heatAdvisory: "NONE",
      tropicalNightStreak: 0,
      medHigh: 0,
      medMid: 0,
      medRegistered: false,
      age: 76,
      livesAlone: true,
      chronicDisease: true,
      noCooling: false,
      shelterCheckInVerified24h: false,
    },
    expectedLevel: "L1",
    weather: { airTemperatureC: 30.1, humidityPct: 57 },
  },
  {
    stableId: "s-003",
    id: "10000000-0000-4000-8000-000000000003",
    name: "가상 대상자 L2",
    birthYear: 1950,
    sex: "FEMALE",
    address: "가상 주소 · 대구 중구 데모 3",
    latitude: 35.8632,
    longitude: 128.591,
    kmaNx: 89,
    kmaNy: 90,
    seniorMode: false,
    medRegistered: true,
    medications: [
      {
        id: "20000000-0000-4000-8000-000000000301",
        productName: "가상 복약 A",
        ingredientName: "DEMO-INGREDIENT-A",
        heatClass: "이뇨제",
        riskTier: "HIGH",
      },
    ],
    checkinState: "NONE",
    hriInput: {
      feelsLikeC: 35,
      heatAdvisory: "NONE",
      tropicalNightStreak: 0,
      medHigh: 1,
      medMid: 0,
      medRegistered: true,
      age: 76,
      livesAlone: true,
      chronicDisease: false,
      noCooling: false,
      shelterCheckInVerified24h: false,
    },
    expectedLevel: "L2",
    weather: { airTemperatureC: 33.2, humidityPct: 64 },
  },
  {
    stableId: "s-004",
    id: "10000000-0000-4000-8000-000000000004",
    name: "가상 대상자 L3",
    birthYear: 1940,
    sex: "MALE",
    address: "가상 주소 · 대구 서구 데모 4",
    latitude: 35.8419,
    longitude: 128.5566,
    kmaNx: 88,
    kmaNy: 90,
    seniorMode: true,
    medRegistered: true,
    medications: [
      {
        id: "20000000-0000-4000-8000-000000000401",
        productName: "가상 복약 B",
        ingredientName: "DEMO-INGREDIENT-B",
        heatClass: "항콜린제",
        riskTier: "HIGH",
      },
      {
        id: "20000000-0000-4000-8000-000000000402",
        productName: "가상 복약 C",
        ingredientName: "DEMO-INGREDIENT-C",
        heatClass: "항우울제",
        riskTier: "HIGH",
      },
    ],
    checkinState: "UNVERIFIED",
    hriInput: {
      feelsLikeC: 38,
      heatAdvisory: "NONE",
      tropicalNightStreak: 0,
      medHigh: 2,
      medMid: 0,
      medRegistered: true,
      age: 86,
      livesAlone: true,
      chronicDisease: true,
      noCooling: true,
      shelterCheckInVerified24h: false,
    },
    expectedLevel: "L3",
    weather: { airTemperatureC: 35.9, humidityPct: 69 },
  },
  {
    stableId: "s-005",
    id: "10000000-0000-4000-8000-000000000005",
    name: "가상 대상자 L4",
    birthYear: 1938,
    sex: "UNDISCLOSED",
    address: "가상 주소 · 대구 서구 데모 5",
    latitude: 35.8815,
    longitude: 128.5602,
    kmaNx: 88,
    kmaNy: 91,
    seniorMode: true,
    medRegistered: true,
    medications: [
      {
        id: "20000000-0000-4000-8000-000000000501",
        productName: "가상 복약 D",
        ingredientName: "DEMO-INGREDIENT-D",
        heatClass: "이뇨제",
        riskTier: "HIGH",
      },
      {
        id: "20000000-0000-4000-8000-000000000502",
        productName: "가상 복약 E",
        ingredientName: "DEMO-INGREDIENT-E",
        heatClass: "항정신병제",
        riskTier: "HIGH",
      },
      {
        id: "20000000-0000-4000-8000-000000000503",
        productName: "가상 복약 F",
        ingredientName: "DEMO-INGREDIENT-F",
        heatClass: "1세대 항히스타민제",
        riskTier: "HIGH",
      },
      {
        id: "20000000-0000-4000-8000-000000000504",
        productName: "가상 복약 G",
        ingredientName: "DEMO-INGREDIENT-G",
        heatClass: "혈압강하제",
        riskTier: "MID",
      },
    ],
    checkinState: "VERIFIED",
    hriInput: {
      feelsLikeC: 40,
      heatAdvisory: "WARNING",
      tropicalNightStreak: 3,
      medHigh: 3,
      medMid: 1,
      medRegistered: true,
      age: 88,
      livesAlone: true,
      chronicDisease: true,
      noCooling: true,
      shelterCheckInVerified24h: true,
    },
    expectedLevel: "L4",
    weather: { airTemperatureC: 37.1, humidityPct: 72 },
  },
] as const;

function countMedicationTiers(medications: readonly DemoMedication[]): {
  high: number;
  mid: number;
} {
  const highClasses = new Set(
    medications.filter(({ riskTier }) => riskTier === "HIGH").map(({ heatClass }) => heatClass),
  );
  const midClasses = new Set(
    medications.filter(({ riskTier }) => riskTier === "MID").map(({ heatClass }) => heatClass),
  );
  return { high: highClasses.size, mid: midClasses.size };
}

function createDemoSubjectFixture(definition: DemoSubjectDefinition): DemoSubjectFixture {
  const risk = computeHri(definition.hriInput);
  const medicationTiers = countMedicationTiers(definition.medications);

  if (risk.level !== definition.expectedLevel) {
    throw new Error(`Demo ${definition.stableId} does not produce ${definition.expectedLevel}`);
  }
  if (
    definition.hriInput.medRegistered !== definition.medRegistered ||
    medicationTiers.high !== definition.hriInput.medHigh ||
    medicationTiers.mid !== definition.hriInput.medMid ||
    (!definition.medRegistered && definition.medications.length > 0)
  ) {
    throw new Error(`Demo ${definition.stableId} medication fixture is inconsistent`);
  }
  if (definition.hriInput.shelterCheckInVerified24h !== (definition.checkinState === "VERIFIED")) {
    throw new Error(`Demo ${definition.stableId} check-in fixture is inconsistent`);
  }
  if (2026 - definition.birthYear !== definition.hriInput.age) {
    throw new Error(`Demo ${definition.stableId} age and birth year disagree`);
  }

  return { ...definition, risk };
}

export const DEMO_SUBJECT_FIXTURES: readonly DemoSubjectFixture[] =
  SUBJECT_DEFINITIONS.map(createDemoSubjectFixture);

/** Quotes a PostgreSQL text literal. NUL cannot be represented in PostgreSQL text. */
export function quoteSqlText(value: string): string {
  if (value.includes("\0")) throw new Error("PostgreSQL text cannot contain NUL");
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlUuid(value: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error("Seed UUID is invalid");
  }
  return `${quoteSqlText(value)}::uuid`;
}

function sqlTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("Seed timestamp must be a canonical ISO instant");
  }
  return `${quoteSqlText(value)}::timestamptz`;
}

function sqlNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Seed number must be finite");
  return String(value);
}

function sqlBoolean(value: boolean): string {
  return value ? "true" : "false";
}

function sqlNullableText(value: string | null): string {
  return value === null ? "null" : quoteSqlText(value);
}

function sqlGeography(longitude: number, latitude: number): string {
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error("Seed point is outside WGS84 bounds");
  }
  return `extensions.st_setsrid(extensions.st_makepoint(${sqlNumber(longitude)}, ${sqlNumber(latitude)}), 4326)::extensions.geography`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sqlTextArray(values: readonly string[]): string {
  if (values.length === 0) throw new Error("Seed text array must not be empty");
  return `array[${values.map(quoteSqlText).join(", ")}]::text[]`;
}

function buildAuthSql(): string {
  const accounts = [
    {
      id: ADMIN_PROFILE_ID,
      email: "demo-admin@onjung.invalid",
      role: "ADMIN",
      displayName: "가상 관리자",
    },
    {
      id: CARE_WORKER_PROFILE_ID,
      email: "demo-care-worker@onjung.invalid",
      role: "CARE_WORKER",
      displayName: "가상 생활지원사",
    },
  ] as const;
  const userRows = accounts.map(({ id, email }) => {
    return `  (${sqlUuid(AUTH_INSTANCE_ID)}, ${sqlUuid(id)}, 'authenticated', 'authenticated', ${quoteSqlText(email)}, extensions.crypt(${quoteSqlText(DEMO_PASSWORD)}, extensions.gen_salt('bf')), ${sqlTimestamp(FIXTURE_CREATED_AT)}, '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, '', '', '', '')`;
  });
  const identityRows = accounts.map(({ id, email }) => {
    return `  (${quoteSqlText(id)}, ${sqlUuid(id)}, jsonb_build_object('sub', ${quoteSqlText(id)}, 'email', ${quoteSqlText(email)}, 'email_verified', true), 'email', ${sqlUuid(id)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)})`;
  });
  const profileRows = accounts.map(({ id, role, displayName }) => {
    return `  (${sqlUuid(id)}, ${sqlUuid(ORGANIZATION_ID)}, ${quoteSqlText(role)}, ${quoteSqlText(displayName)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)})`;
  });

  return `-- Local-only identities. The reserved .invalid domain cannot receive mail.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
${userRows.join(",\n")}
on conflict (id) do update
set
  aud = excluded.aud,
  role = excluded.role,
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = excluded.updated_at;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, id,
  last_sign_in_at, created_at, updated_at
)
values
${identityRows.join(",\n")}
on conflict (provider_id, provider) do update
set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  id = excluded.id,
  updated_at = excluded.updated_at;

insert into public.organizations (id, name, created_at)
values (${sqlUuid(ORGANIZATION_ID)}, '온중 데모 조직 (가상)', ${sqlTimestamp(FIXTURE_CREATED_AT)})
on conflict (id) do update
set name = excluded.name;

insert into public.profiles (id, organization_id, role, display_name, created_at, updated_at)
values
${profileRows.join(",\n")}
on conflict (id) do update
set
  organization_id = excluded.organization_id,
  role = excluded.role,
  display_name = excluded.display_name,
  updated_at = excluded.updated_at;`;
}

function buildShelterSql(collection: ShelterFeatureCollection): string {
  const rows = collection.features.map((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    const properties = feature.properties;
    return `  (${quoteSqlText(feature.id)}, ${quoteSqlText(properties.name)}, ${quoteSqlText(properties.gu)}, ${quoteSqlText(properties.facility_type)}, ${sqlBoolean(properties.is_im_bank)}, ${quoteSqlText(properties.road_address)}, ${sqlGeography(longitude, latitude)}, ${sqlNumber(properties.kma_nx)}, ${sqlNumber(properties.kma_ny)}, ${quoteSqlText(properties.source_geo_idn)}, ${quoteSqlText(properties.geocode_result)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)})`;
  });

  return `-- BEGIN SHELTERS (audited source count: 950)
insert into public.shelters (
  id, name, gu, facility_type, is_im_bank, road_address, location,
  kma_nx, kma_ny, source_geo_idn, geocode_result, imported_at, updated_at
)
values
${rows.join(",\n")}
on conflict (id) do update
set
  name = excluded.name,
  gu = excluded.gu,
  facility_type = excluded.facility_type,
  is_im_bank = excluded.is_im_bank,
  road_address = excluded.road_address,
  location = excluded.location,
  kma_nx = excluded.kma_nx,
  kma_ny = excluded.kma_ny,
  source_geo_idn = excluded.source_geo_idn,
  geocode_result = excluded.geocode_result,
  imported_at = excluded.imported_at,
  updated_at = excluded.updated_at;
-- END SHELTERS`;
}

function buildSubjectSql(): string {
  const subjectRows = DEMO_SUBJECT_FIXTURES.map((fixture) => {
    const registeredAt = fixture.medRegistered ? sqlTimestamp(FIXTURE_CREATED_AT) : "null";
    return `  (${sqlUuid(fixture.id)}, ${sqlUuid(ORGANIZATION_ID)}, ${quoteSqlText(fixture.name)}, ${sqlNumber(fixture.birthYear)}, ${quoteSqlText(fixture.sex)}, null, null, ${quoteSqlText(fixture.address)}, ${sqlGeography(fixture.longitude, fixture.latitude)}, ${sqlNumber(fixture.kmaNx)}, ${sqlNumber(fixture.kmaNy)}, ${sqlBoolean(fixture.hriInput.livesAlone)}, ${sqlBoolean(fixture.hriInput.chronicDisease)}, ${sqlBoolean(!fixture.hriInput.noCooling)}, ${sqlBoolean(fixture.seniorMode)}, ${registeredAt}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)})`;
  });
  const assignmentRows = DEMO_SUBJECT_FIXTURES.map((fixture) => {
    return `  (${sqlUuid(ORGANIZATION_ID)}, ${sqlUuid(fixture.id)}, ${sqlUuid(CARE_WORKER_PROFILE_ID)}, ${sqlTimestamp(FIXTURE_CREATED_AT)})`;
  });

  return `-- Five fictional subjects intentionally cover L0, L1, L2, L3, and L4.
insert into public.subjects (
  id, organization_id, name, birth_year, sex, phone, guardian_phone, address,
  location, kma_nx, kma_ny, lives_alone, chronic_disease, has_cooling,
  senior_mode, medication_profile_registered_at, consented_at, pii_updated_at,
  created_at, updated_at
)
values
${subjectRows.join(",\n")}
on conflict (id) do update
set
  organization_id = excluded.organization_id,
  name = excluded.name,
  birth_year = excluded.birth_year,
  sex = excluded.sex,
  phone = excluded.phone,
  guardian_phone = excluded.guardian_phone,
  address = excluded.address,
  location = excluded.location,
  kma_nx = excluded.kma_nx,
  kma_ny = excluded.kma_ny,
  lives_alone = excluded.lives_alone,
  chronic_disease = excluded.chronic_disease,
  has_cooling = excluded.has_cooling,
  senior_mode = excluded.senior_mode,
  medication_profile_registered_at = excluded.medication_profile_registered_at,
  consented_at = excluded.consented_at,
  pii_updated_at = excluded.pii_updated_at,
  updated_at = excluded.updated_at;

insert into public.subject_assignments (organization_id, subject_id, profile_id, assigned_at)
values
${assignmentRows.join(",\n")}
on conflict (subject_id, profile_id) do update
set
  organization_id = excluded.organization_id,
  assigned_at = excluded.assigned_at;`;
}

function buildGuardianNotificationPreferenceSql(): string {
  const rows = DEMO_SUBJECT_FIXTURES.map(
    (fixture, index) =>
      `  (${sqlUuid(fixture.id)}, ${quoteSqlText(sha256(`demo-recipient:${fixture.stableId}`))}, 1, 'demo-v1', 'LOCAL_FIXTURE', ${sqlUuid(`70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, null, true, false, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)})`,
  );

  return `-- Demo-only opaque recipient references: sha256("demo-recipient:<fixture>").
-- They are not phone numbers and production preferences must use a server HMAC.
-- Consent evidence below is deterministic local fixture metadata, never a production record.
insert into public.guardian_notification_preferences (
  subject_id, recipient_ref, revision, consent_text_version, consent_source,
  consent_evidence_id, consented_at, withdrawn_at, sms_enabled, alimtalk_enabled,
  created_at, updated_at
)
values
${rows.join(",\n")}
on conflict (subject_id) do update
set
  recipient_ref = excluded.recipient_ref,
  revision = excluded.revision,
  consent_text_version = excluded.consent_text_version,
  consent_source = excluded.consent_source,
  consent_evidence_id = excluded.consent_evidence_id,
  consented_at = excluded.consented_at,
  withdrawn_at = excluded.withdrawn_at,
  sms_enabled = excluded.sms_enabled,
  alimtalk_enabled = excluded.alimtalk_enabled,
  updated_at = excluded.updated_at;`;
}

function buildSpatialDemoSql(collection: ShelterFeatureCollection): string {
  const anchor = collection.features[0];
  if (!anchor) throw new Error("A shelter is required to anchor Demo spatial fixtures");
  const [longitude, latitude] = anchor.geometry.coordinates;
  const buildingReleaseId = "60000000-0000-4000-8000-000000000001";
  const restReleaseId = "60000000-0000-4000-8000-000000000002";
  const barrierReleaseId = "60000000-0000-4000-8000-000000000003";
  const sourceUrl = "https://example.invalid/onjung-spatial-demo";
  const unknownReason = "시연용 부분 fixture이며 대구 전역 현장 검증 자료가 아님";
  const delta = 0.00012;
  const building = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [longitude - delta, latitude - delta],
          [longitude + delta, latitude - delta],
          [longitude + delta, latitude + delta],
          [longitude - delta, latitude + delta],
          [longitude - delta, latitude - delta],
        ],
      ],
    ],
  };
  const restSpot = { type: "Point", coordinates: [longitude + delta * 2, latitude] };
  const barrier = {
    type: "LineString",
    coordinates: [
      [longitude + 0.002, latitude - delta],
      [longitude + 0.002, latitude + delta],
    ],
  };

  return `-- Deterministic spatial Demo fixtures. These rows must never be presented as
-- verified or complete Daegu coverage.
insert into public.spatial_data_releases (
  id, dataset, version, source_name, source_url, source_license, source_crs,
  target_crs, coverage, confidence, unknown_reason, source_updated_at,
  imported_at, active
)
values
  (${sqlUuid(buildingReleaseId)}, 'BUILDING', 'demo-v1', '온중 Demo 공간 fixture', ${quoteSqlText(sourceUrl)}, 'DEMO_FIXTURE_NOT_REAL_DATA', 'EPSG:4326', 'EPSG:4326', 'COMMUNITY_PARTIAL', 'UNKNOWN', ${quoteSqlText(unknownReason)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, true),
  (${sqlUuid(restReleaseId)}, 'REST_SPOT', 'demo-v1', '온중 Demo 공간 fixture', ${quoteSqlText(sourceUrl)}, 'DEMO_FIXTURE_NOT_REAL_DATA', 'EPSG:4326', 'EPSG:4326', 'COMMUNITY_PARTIAL', 'UNKNOWN', ${quoteSqlText(unknownReason)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, true),
  (${sqlUuid(barrierReleaseId)}, 'BARRIER', 'demo-v1', '온중 Demo 공간 fixture', ${quoteSqlText(sourceUrl)}, 'DEMO_FIXTURE_NOT_REAL_DATA', 'EPSG:4326', 'EPSG:4326', 'COMMUNITY_PARTIAL', 'UNKNOWN', ${quoteSqlText(unknownReason)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, true)
on conflict (dataset, version) do update
set
  source_name = excluded.source_name,
  source_url = excluded.source_url,
  source_license = excluded.source_license,
  source_crs = excluded.source_crs,
  target_crs = excluded.target_crs,
  coverage = excluded.coverage,
  confidence = excluded.confidence,
  unknown_reason = excluded.unknown_reason,
  source_updated_at = excluded.source_updated_at,
  imported_at = excluded.imported_at,
  active = excluded.active;

insert into public.building_footprints (
  release_id, source_feature_id, geom, height_m, height_source,
  height_is_estimated, height_estimation_version, source_crs, target_crs,
  coverage, confidence, unknown_reason, source_updated_at
)
values (
  ${sqlUuid(buildingReleaseId)}, 'demo-building-1',
  extensions.st_geomfromgeojson(${quoteSqlText(JSON.stringify(building))}),
  12, 'DEMO_FLOOR_ESTIMATE', true, 'DEMO_FLOOR_HEIGHT_3M_V1',
  'EPSG:4326', 'EPSG:4326', 'COMMUNITY_PARTIAL', 'UNKNOWN',
  ${quoteSqlText(unknownReason)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}
)
on conflict (release_id, source_feature_id) do update
set geom = excluded.geom, height_m = excluded.height_m,
  height_source = excluded.height_source,
  height_is_estimated = excluded.height_is_estimated,
  height_estimation_version = excluded.height_estimation_version,
  unknown_reason = excluded.unknown_reason;

insert into public.rest_spots (
  release_id, source_feature_id, rest_type, geom, source_crs, target_crs,
  coverage, confidence, unknown_reason, source_updated_at
)
values (
  ${sqlUuid(restReleaseId)}, 'demo-rest-1', 'BENCH',
  extensions.st_geomfromgeojson(${quoteSqlText(JSON.stringify(restSpot))}),
  'EPSG:4326', 'EPSG:4326', 'COMMUNITY_PARTIAL', 'UNKNOWN',
  ${quoteSqlText(unknownReason)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}
)
on conflict (release_id, source_feature_id) do update
set geom = excluded.geom, rest_type = excluded.rest_type,
  unknown_reason = excluded.unknown_reason;

insert into public.barrier_segments (
  release_id, source_feature_id, barrier_type, slope_percent, geom,
  source_crs, target_crs, coverage, confidence, unknown_reason, source_updated_at
)
values (
  ${sqlUuid(barrierReleaseId)}, 'demo-barrier-1', 'STAIRS', null,
  extensions.st_geomfromgeojson(${quoteSqlText(JSON.stringify(barrier))}),
  'EPSG:4326', 'EPSG:4326', 'COMMUNITY_PARTIAL', 'UNKNOWN',
  ${quoteSqlText(unknownReason)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}
)
on conflict (release_id, source_feature_id) do update
set geom = excluded.geom, barrier_type = excluded.barrier_type,
  slope_percent = excluded.slope_percent, unknown_reason = excluded.unknown_reason;`;
}

function buildMedicationSql(): string {
  const rows = DEMO_SUBJECT_FIXTURES.flatMap((fixture) => {
    return fixture.medications.map((medication) => {
      return `  (${sqlUuid(medication.id)}, ${sqlUuid(fixture.id)}, ${quoteSqlText(medication.productName)}, null, ${quoteSqlText(medication.ingredientName)}, ${quoteSqlText(medication.heatClass)}, ${quoteSqlText(medication.riskTier)}, 'MANUAL', 1, null, ${sqlUuid(CARE_WORKER_PROFILE_ID)}, ${sqlTimestamp(FIXTURE_CREATED_AT)}, ${sqlTimestamp(FIXTURE_CREATED_AT)})`;
    });
  });
  if (rows.length === 0) throw new Error("Medication fixtures are missing");

  return `-- s-001 is reviewed with no medicines; s-002 is deliberately unregistered.
insert into public.medications (
  id, subject_id, product_name, item_seq, ingredient_name, heat_class,
  risk_tier, source, confidence, scan_session_id, confirmed_by, created_at, updated_at
)
values
${rows.join(",\n")}
on conflict (id) do update
set
  subject_id = excluded.subject_id,
  product_name = excluded.product_name,
  item_seq = excluded.item_seq,
  ingredient_name = excluded.ingredient_name,
  heat_class = excluded.heat_class,
  risk_tier = excluded.risk_tier,
  source = excluded.source,
  confidence = excluded.confidence,
  scan_session_id = excluded.scan_session_id,
  confirmed_by = excluded.confirmed_by,
  updated_at = excluded.updated_at;`;
}

function buildWeatherSql(): string {
  const rows = DEMO_SUBJECT_FIXTURES.map((fixture) => {
    return `  (${quoteSqlText(`apihub:demo:${fixture.stableId}`)}, 'KMA_APIHUB_500M', ${sqlGeography(fixture.longitude, fixture.latitude)}, ${sqlNumber(fixture.kmaNx)}, ${sqlNumber(fixture.kmaNy)}, ${sqlNumber(fixture.weather.airTemperatureC)}, ${sqlNumber(fixture.weather.humidityPct)}, ${sqlNumber(fixture.hriInput.feelsLikeC)}, ${quoteSqlText(fixture.hriInput.heatAdvisory)}, ${sqlNumber(fixture.hriInput.tropicalNightStreak)}, false, false, null, ${sqlTimestamp(WEATHER_OBSERVED_AT)}, ${sqlTimestamp(WEATHER_COLLECTED_AT)}, ${sqlTimestamp(WEATHER_EXPIRES_AT)})`;
  });

  return `insert into public.weather_snapshots (
  location_key, source, location, kma_nx, kma_ny, temperature_c,
  humidity_pct, feels_like_c, advisory, tropical_night_streak,
  is_partial, is_stale, error_code, observed_at, collected_at, expires_at
)
values
${rows.join(",\n")}
on conflict (location_key, source, observed_at, collected_at) do update
set
  location = excluded.location,
  kma_nx = excluded.kma_nx,
  kma_ny = excluded.kma_ny,
  temperature_c = excluded.temperature_c,
  humidity_pct = excluded.humidity_pct,
  feels_like_c = excluded.feels_like_c,
  advisory = excluded.advisory,
  tropical_night_streak = excluded.tropical_night_streak,
  is_partial = excluded.is_partial,
  is_stale = excluded.is_stale,
  error_code = excluded.error_code,
  collected_at = excluded.collected_at,
  expires_at = excluded.expires_at;`;
}

function buildCheckinSql(collection: ShelterFeatureCollection): string {
  const verifiedShelter = collection.features.find(({ properties }) => properties.is_im_bank);
  const unverifiedShelter = collection.features.find(({ properties }) => !properties.is_im_bank);
  if (!verifiedShelter || !unverifiedShelter) {
    throw new Error("Both iM Bank and non-bank shelter fixtures are required");
  }

  const rows = DEMO_SUBJECT_FIXTURES.flatMap((fixture) => {
    if (fixture.checkinState === "NONE") return [];
    const verified = fixture.checkinState === "VERIFIED";
    const shelterId = verified ? verifiedShelter.id : unverifiedShelter.id;
    const id = verified
      ? "30000000-0000-4000-8000-000000000501"
      : "30000000-0000-4000-8000-000000000401";
    const actorScope = verified ? "SUBJECT_SCOPED" : "CAREGIVER";
    const attestationUid = verified ? `0x${sha256(`demo-checkin:${id}`)}` : null;
    const verifiedAt = verified ? sqlTimestamp(RISK_COMPUTED_AT) : "null";
    return [
      `  (${sqlUuid(id)}, ${sqlUuid(fixture.id)}, ${quoteSqlText(shelterId)}, ${sqlTimestamp(CHECKED_IN_AT)}, ${quoteSqlText(actorScope)}, ${quoteSqlText(sha256(`demo-actor:${fixture.stableId}`))}, ${quoteSqlText(fixture.checkinState)}, ${sqlNullableText(attestationUid)}, ${sqlUuid(id)}, ${verifiedAt}, ${sqlTimestamp(RISK_COMPUTED_AT)})`,
    ];
  });

  return `-- UNVERIFIED never grants C=6; VERIFIED does for the matching snapshot window.
insert into public.shelter_checkins (
  id, subject_id, shelter_id, checked_in_at, actor_scope, actor_ref_hash,
  attestation_state, attestation_uid, client_request_id,
  attestation_verified_at, created_at
)
values
${rows.join(",\n")}
on conflict (id) do update
set
  subject_id = excluded.subject_id,
  shelter_id = excluded.shelter_id,
  checked_in_at = excluded.checked_in_at,
  actor_scope = excluded.actor_scope,
  actor_ref_hash = excluded.actor_ref_hash,
  attestation_state = excluded.attestation_state,
  attestation_uid = excluded.attestation_uid,
  client_request_id = excluded.client_request_id,
  attestation_verified_at = excluded.attestation_verified_at;`;
}

function buildRiskReasons(fixture: DemoSubjectFixture): readonly string[] {
  const scored = [
    { score: fixture.risk.breakdown.E, text: `환경 점수 (+${fixture.risk.breakdown.E})` },
    { score: fixture.risk.breakdown.M, text: `복약 점수 (+${fixture.risk.breakdown.M})` },
    { score: fixture.risk.breakdown.P, text: `개인 점수 (+${fixture.risk.breakdown.P})` },
  ]
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ text }) => text);
  if (scored.length === 0) return ["현재 가산 위험 요인이 없습니다"];
  return scored;
}

function buildRiskSql(): string {
  const rows = DEMO_SUBJECT_FIXTURES.map((fixture) => {
    const breakdownJson = JSON.stringify(fixture.risk.breakdown);
    const inputHash = sha256(
      JSON.stringify({ subject: fixture.stableId, input: fixture.hriInput }),
    );
    const weatherLookup = `(select id from public.weather_snapshots where location_key = ${quoteSqlText(`apihub:demo:${fixture.stableId}`)} and source = 'KMA_APIHUB_500M' and observed_at = ${sqlTimestamp(WEATHER_OBSERVED_AT)} and collected_at = ${sqlTimestamp(WEATHER_COLLECTED_AT)})`;
    return `  (${sqlUuid(fixture.id)}, ${weatherLookup}, ${sqlNumber(fixture.risk.score)}, ${quoteSqlText(fixture.risk.level)}, ${quoteSqlText(breakdownJson)}::jsonb, ${sqlTextArray(buildRiskReasons(fixture))}, ${quoteSqlText(inputHash)}, ${sqlTimestamp(RISK_BUCKET_START)}, ${sqlTimestamp(RISK_COMPUTED_AT)})`;
  });

  const scenarioComment = DEMO_SUBJECT_FIXTURES.map((fixture) => {
    const { E, M, P, C } = fixture.risk.breakdown;
    return `-- ${fixture.stableId}: ${fixture.risk.level} = ${fixture.risk.score} (${E} + ${M} + ${P} - ${C}); medication=${fixture.medRegistered ? "registered" : "unregistered"}; checkin=${fixture.checkinState}`;
  }).join("\n");

  return `${scenarioComment}
insert into public.risk_snapshots (
  subject_id, weather_snapshot_id, hri, level, breakdown, reasons,
  input_hash, bucket_start, computed_at
)
values
${rows.join(",\n")}
on conflict (subject_id, bucket_start, input_hash) do update
set
  weather_snapshot_id = excluded.weather_snapshot_id,
  hri = excluded.hri,
  level = excluded.level,
  breakdown = excluded.breakdown,
  reasons = excluded.reasons,
  computed_at = excluded.computed_at;`;
}

export function buildSeedSql(collection: ShelterFeatureCollection): string {
  assertShelterInvariants(collection);

  return `-- Generated local-only Demo fixture. Do not edit by hand.
-- All people, addresses, medicines, identities, and attestations below are fictional.
-- Contract: shelters=950; facilities=466/245/129/110; im_bank=100; districts=8.
begin;
set local standard_conforming_strings = on;

${buildAuthSql()}

${buildShelterSql(collection)}

${buildSpatialDemoSql(collection)}

${buildSubjectSql()}

${buildGuardianNotificationPreferenceSql()}

${buildMedicationSql()}

${buildWeatherSql()}

${buildCheckinSql(collection)}

${buildRiskSql()}

commit;
`;
}

type GeneratorMode = "check" | "write";

function parseMode(arguments_: readonly string[]): GeneratorMode {
  if (arguments_.length === 1 && arguments_[0] === "--check") return "check";
  if (arguments_.length === 1 && arguments_[0] === "--write") return "write";
  throw new Error("Usage: bun scripts/generate-supabase-seed.ts --check|--write");
}

export async function runSeedGenerator(mode: GeneratorMode): Promise<void> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(scriptDirectory, "..");
  const geoJsonPath = resolve(projectRoot, "data", "daegu_shelters.geojson");
  const seedPath = resolve(projectRoot, "supabase", "fixtures", "local-demo.sql");
  const collection = JSON.parse(await readFile(geoJsonPath, "utf8")) as ShelterFeatureCollection;
  const generatedSql = buildSeedSql(collection);

  if (mode === "write") {
    await writeFile(seedPath, generatedSql, "utf8");
    console.log("Local Supabase Demo fixture wrote 950 shelters and 5 fictional subjects.");
    return;
  }

  let checkedInSql: string;
  try {
    checkedInSql = await readFile(seedPath, "utf8");
  } catch {
    throw new Error("Checked-in local Supabase Demo fixture is missing");
  }
  if (checkedInSql !== generatedSql) {
    throw new Error("Checked-in local Supabase Demo fixture is out of date");
  }
  console.log("Local Supabase Demo fixture verified 950 shelters and 5 fictional subjects.");
}

async function main(): Promise<void> {
  try {
    await runSeedGenerator(parseMode(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected seed generator error";
    console.error(`Supabase seed generation failed: ${message}`);
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) {
  void main();
}
