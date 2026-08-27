import { describe, expect, it } from "vitest";

import {
  CARE_EVENT_FIELDS,
  CARE_EVENT_SCHEMA,
  CARE_EVENT_TYPE,
  CareEventCodec,
  RISK_LEVEL_CODE,
  SHELTER_STATUS_FIELDS,
  SHELTER_STATUS_SCHEMA,
  ShelterStatusCodec,
  parseEasUid,
} from "./schemas";

const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const SUBJECT_ID = "10000000-0000-4000-8000-000000000001";

describe("CareEvent EAS allowlist codec", () => {
  const fixture = {
    subjectHash: HASH_A,
    eventType: CARE_EVENT_TYPE.ALERT_SENT,
    riskLevel: RISK_LEVEL_CODE.L3,
    hriScore: 72,
    occurredAt: 1_777_131_792n,
    payloadHash: HASH_B,
  } as const;

  it("fixes the schema text and exact EAS field order", () => {
    expect(CARE_EVENT_SCHEMA).toBe(
      "bytes32 subjectHash,uint8 eventType,uint8 riskLevel,uint16 hriScore,uint64 occurredAt,bytes32 payloadHash",
    );
    expect(CARE_EVENT_FIELDS).toEqual([
      ["subjectHash", "bytes32"],
      ["eventType", "uint8"],
      ["riskLevel", "uint8"],
      ["hriScore", "uint16"],
      ["occurredAt", "uint64"],
      ["payloadHash", "bytes32"],
    ]);
    expect(CareEventCodec.encode(fixture).map(({ name, type }) => [name, type])).toEqual(
      CARE_EVENT_FIELDS,
    );
  });

  it("encodes only event 0/1/2, risk 0..4, HRI 0..100, and uint64 timestamps", () => {
    expect(CareEventCodec.parse(fixture)).toEqual(fixture);

    for (const eventType of [0, 1, 2]) {
      expect(CareEventCodec.parse({ ...fixture, eventType }).eventType).toBe(eventType);
    }
    for (const riskLevel of [0, 1, 2, 3, 4]) {
      expect(CareEventCodec.parse({ ...fixture, riskLevel }).riskLevel).toBe(riskLevel);
    }

    for (const input of [
      { ...fixture, eventType: -1 },
      { ...fixture, eventType: 3 },
      { ...fixture, riskLevel: -1 },
      { ...fixture, riskLevel: 5 },
      { ...fixture, hriScore: -1 },
      { ...fixture, hriScore: 101 },
      { ...fixture, occurredAt: -1n },
      { ...fixture, occurredAt: 1n << 64n },
      { ...fixture, subjectHash: `0x${"a".repeat(62)}` },
    ]) {
      expect(() => CareEventCodec.parse(input)).toThrow();
    }
  });

  it.each(["name", "phone", "address", "birthDate", "medicationName", "subjectId"])(
    "rejects the personal-data key %s instead of silently stripping it",
    (key) => {
      expect(() => CareEventCodec.parse({ ...fixture, [key]: "private" })).toThrow();
    },
  );

  it("rejects raw subject UUIDs and personal-data values in every encoded string slot", () => {
    for (const value of [SUBJECT_ID, "김온정", "010-1234-5678", "대구광역시 중구", "푸로세미드"]) {
      expect(() => CareEventCodec.parse({ ...fixture, subjectHash: value })).toThrow();
      expect(() => CareEventCodec.parse({ ...fixture, payloadHash: value })).toThrow();
    }
    expect(
      CareEventCodec.encode(fixture)
        .map(({ value }) => String(value))
        .join("|"),
    ).not.toContain(SUBJECT_ID);
  });
});

describe("ShelterStatus EAS allowlist codec", () => {
  const fixture = {
    shelterId: "DG-0001",
    isOpen: true,
    crowdLevel: 2,
    observedAt: 1_777_131_792n,
    reporterHash: HASH_A,
  } as const;

  it("fixes the schema text and exact EAS field order", () => {
    expect(SHELTER_STATUS_SCHEMA).toBe(
      "string shelterId,bool isOpen,uint8 crowdLevel,uint64 observedAt,bytes32 reporterHash",
    );
    expect(SHELTER_STATUS_FIELDS).toEqual([
      ["shelterId", "string"],
      ["isOpen", "bool"],
      ["crowdLevel", "uint8"],
      ["observedAt", "uint64"],
      ["reporterHash", "bytes32"],
    ]);
    expect(ShelterStatusCodec.encode(fixture).map(({ name, type }) => [name, type])).toEqual(
      SHELTER_STATUS_FIELDS,
    );
  });

  it("accepts only master shelter IDs, booleans, crowd 0..2, uint64 time, and bytes32 hashes", () => {
    expect(ShelterStatusCodec.parse(fixture)).toEqual(fixture);

    for (const input of [
      { ...fixture, shelterId: "DG-001" },
      { ...fixture, shelterId: SUBJECT_ID },
      { ...fixture, isOpen: "true" },
      { ...fixture, crowdLevel: -1 },
      { ...fixture, crowdLevel: 3 },
      { ...fixture, observedAt: -1n },
      { ...fixture, observedAt: 1n << 64n },
      { ...fixture, reporterHash: SUBJECT_ID },
    ]) {
      expect(() => ShelterStatusCodec.parse(input)).toThrow();
    }
  });

  it.each(["name", "phoneNumber", "address", "birthYear", "drugName", "subjectUuid"])(
    "rejects the personal-data key %s instead of silently stripping it",
    (key) => {
      expect(() => ShelterStatusCodec.parse({ ...fixture, [key]: "private" })).toThrow();
    },
  );

  it("rejects personal-data values in its only unhashed string field", () => {
    for (const value of [SUBJECT_ID, "김온정", "010-1234-5678", "대구광역시 중구", "푸로세미드"]) {
      expect(() => ShelterStatusCodec.parse({ ...fixture, shelterId: value })).toThrow();
    }
  });
});

describe("EAS UID boundary", () => {
  it("accepts only a 0x-prefixed 32-byte hexadecimal UID", () => {
    const uid = `0x${"1a".repeat(32)}`;
    expect(parseEasUid(uid)).toBe(uid);
    expect(parseEasUid(uid.toUpperCase().replace("0X", "0x"))).toBe(uid);

    for (const value of [
      "1a".repeat(32),
      `0x${"a".repeat(63)}`,
      `0x${"g".repeat(64)}`,
      SUBJECT_ID,
    ]) {
      expect(() => parseEasUid(value)).toThrow();
    }
  });
});
