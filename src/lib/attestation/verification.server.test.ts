import { encodeAbiParameters, parseAbiParameters } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  BASE_SEPOLIA_CHAIN_ID,
  verifyEasAttestation,
  type EasVerificationLookupPort,
  type EasVerificationPolicy,
} from "./verification.server";
import { computeRequiredSchemaUids } from "./schema-registration.server";

const UID = `0x${"11".repeat(32)}` as `0x${string}`;
const REQUIRED_SCHEMA_UIDS = computeRequiredSchemaUids();
const CARE_SCHEMA_UID = REQUIRED_SCHEMA_UIDS.careEvent;
const SHELTER_SCHEMA_UID = REQUIRED_SCHEMA_UIDS.shelterStatus;
const SUBJECT_HASH = `0x${"44".repeat(32)}` as `0x${string}`;
const PAYLOAD_HASH = `0x${"55".repeat(32)}` as `0x${string}`;
const REPORTER_HASH = `0x${"66".repeat(32)}` as `0x${string}`;
const ISSUER = `0x${"ab".repeat(20)}` as `0x${string}`;

const policy: EasVerificationPolicy = {
  careSchemaUid: CARE_SCHEMA_UID,
  shelterSchemaUid: SHELTER_SCHEMA_UID,
  expectedIssuer: ISSUER,
};

const careData = encodeAbiParameters(
  parseAbiParameters(
    "bytes32 subjectHash,uint8 eventType,uint8 riskLevel,uint16 hriScore,uint64 occurredAt,bytes32 payloadHash",
  ),
  [SUBJECT_HASH, 2, 3, 72, 1_787_460_192n, PAYLOAD_HASH],
);

const shelterData = encodeAbiParameters(
  parseAbiParameters(
    "string shelterId,bool isOpen,uint8 crowdLevel,uint64 observedAt,bytes32 reporterHash",
  ),
  ["DG-0001", true, 1, 1_787_460_192n, REPORTER_HASH],
);

function record(
  overrides: Partial<{
    chainId: number;
    uid: string;
    schema: string;
    attester: string;
    time: bigint;
    expirationTime: bigint;
    revocationTime: bigint;
    data: string;
  }> = {},
) {
  const { chainId = BASE_SEPOLIA_CHAIN_ID, ...attestationOverrides } = overrides;
  return {
    chainId,
    attestation: {
      uid: UID,
      schema: CARE_SCHEMA_UID,
      attester: ISSUER,
      time: 1_787_460_200n,
      expirationTime: 0n,
      revocationTime: 0n,
      data: careData,
      ...attestationOverrides,
    },
  };
}

function port(value: unknown): EasVerificationLookupPort {
  return { lookup: vi.fn().mockResolvedValue(value) };
}

describe("public Base Sepolia EAS verification", () => {
  it("rejects malformed UIDs without touching the RPC port", async () => {
    const lookup = vi.fn();
    const result = await verifyEasAttestation("0x1234", policy, { lookup });

    expect(result).toEqual({ status: "NOT_FOUND" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns only the CareEvent allowlist after chain, schema, and issuer checks", async () => {
    const result = await verifyEasAttestation(
      UID.toUpperCase().replace("0X", "0x"),
      policy,
      port(record()),
    );

    expect(result).toMatchObject({
      status: "VERIFIED",
      network: "Base Sepolia 테스트넷",
      chainId: 84532,
      uid: UID,
      schema: { kind: "CARE_EVENT", label: "CareEvent v1", uid: CARE_SCHEMA_UID },
      issuer: ISSUER,
      details: {
        kind: "CARE_EVENT",
        eventType: "보호자 알림 발송",
        riskLevel: "L3 경고",
        hriScore: 72,
        occurredAt: "2026-08-23T04:43:12.000Z",
        subjectHash: SUBJECT_HASH,
        payloadHash: PAYLOAD_HASH,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/subjectId|name|phone|address|private/i);
  });

  it("decodes only the public ShelterStatus fields", async () => {
    const result = await verifyEasAttestation(
      UID,
      policy,
      port(record({ schema: SHELTER_SCHEMA_UID, data: shelterData })),
    );

    expect(result).toMatchObject({
      status: "VERIFIED",
      schema: { kind: "SHELTER_STATUS", label: "ShelterStatus v1" },
      details: {
        kind: "SHELTER_STATUS",
        shelterId: "DG-0001",
        isOpen: true,
        crowdLevel: "보통",
        observedAt: "2026-08-23T04:43:12.000Z",
        reporterHash: REPORTER_HASH,
      },
    });
  });

  it.each([
    ["wrong chain", record({ chainId: 1 })],
    ["unknown schema", record({ schema: `0x${"77".repeat(32)}` })],
    ["wrong issuer", record({ attester: `0x${"cd".repeat(20)}` })],
    ["malformed payload", record({ data: "0x1234" })],
  ])("does not verify %s", async (_case, raw) => {
    await expect(verifyEasAttestation(UID, policy, port(raw))).resolves.toEqual({
      status: "NOT_OURS",
      uid: UID,
    });
  });

  it("distinguishes a missing UID from an unavailable RPC", async () => {
    await expect(
      verifyEasAttestation(
        UID,
        policy,
        port({ chainId: BASE_SEPOLIA_CHAIN_ID, attestation: null }),
      ),
    ).resolves.toEqual({ status: "NOT_FOUND" });

    await expect(
      verifyEasAttestation(UID, policy, {
        lookup: vi.fn().mockRejectedValue(new Error("rpc contains internal details")),
      }),
    ).resolves.toEqual({ status: "TEMPORARY_UNAVAILABLE", uid: UID });
  });

  it("reports a matching revoked attestation without decoding it as verified", async () => {
    const result = await verifyEasAttestation(
      UID,
      policy,
      port(record({ revocationTime: 1_787_460_300n })),
    );

    expect(result).toMatchObject({
      status: "REVOKED",
      uid: UID,
      revokedAt: "2026-08-23T04:45:00.000Z",
      schema: { label: "CareEvent v1" },
      issuer: ISSUER,
    });
    expect(result).not.toHaveProperty("details");
  });

  it("treats invalid deployment policy as a temporary server configuration issue", async () => {
    const lookup = vi.fn();
    const result = await verifyEasAttestation(
      UID,
      { ...policy, expectedIssuer: "secret-or-invalid" },
      { lookup },
    );

    expect(result).toEqual({ status: "TEMPORARY_UNAVAILABLE", uid: UID });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("fails closed when configuration names arbitrary schemas as Onjung schemas", async () => {
    const lookup = vi.fn();
    const result = await verifyEasAttestation(
      UID,
      {
        careSchemaUid: `0x${"aa".repeat(32)}`,
        shelterSchemaUid: `0x${"bb".repeat(32)}`,
        expectedIssuer: ISSUER,
      },
      { lookup },
    );

    expect(result).toEqual({ status: "TEMPORARY_UNAVAILABLE", uid: UID });
    expect(lookup).not.toHaveBeenCalled();
  });
});
