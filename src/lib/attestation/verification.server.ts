import "@tanstack/react-start/server-only";

import { createPublicClient, decodeAbiParameters, http, parseAbiParameters } from "viem";
import { baseSepolia } from "viem/chains";
import { z } from "zod";

import { CareEventCodec, ShelterStatusCodec, parseEasUid, type Bytes32Hex } from "./schemas";
import { REQUIRED_EAS_SCHEMA_UIDS } from "./schema-uids.server";

export const BASE_SEPOLIA_CHAIN_ID = 84_532 as const;
export const BASE_SEPOLIA_NETWORK_NAME = "Base Sepolia 테스트넷" as const;
export const BASE_SEPOLIA_EAS_ADDRESS = "0x4200000000000000000000000000000000000021" as const;
export const BASE_SEPOLIA_EAS_EXPLORER = "https://base-sepolia.easscan.org" as const;

const ZERO_UID = `0x${"00".repeat(32)}` as Bytes32Hex;
const MAX_SUPPORTED_UNIX_SECONDS = 253_402_300_799n;

const uidSchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/iu)
  .transform((value) => value.toLowerCase() as Bytes32Hex);
const addressSchema = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/iu)
  .transform((value) => value.toLowerCase() as `0x${string}`);
const uint64Schema = z
  .bigint()
  .min(0n)
  .max((1n << 64n) - 1n);
const encodedDataSchema = z
  .string()
  .regex(/^0x(?:[0-9a-f]{2})*$/iu)
  .transform((value) => value.toLowerCase() as `0x${string}`);

const VerificationPolicySchema = z
  .object({
    careSchemaUid: uidSchema,
    shelterSchemaUid: uidSchema,
    expectedIssuer: addressSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.careSchemaUid === value.shelterSchemaUid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected EAS schemas must be distinct",
      });
    }
    if (value.careSchemaUid !== REQUIRED_EAS_SCHEMA_UIDS.careEvent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["careSchemaUid"],
        message: "Expected care schema must be the fixed Onjung schema",
      });
    }
    if (value.shelterSchemaUid !== REQUIRED_EAS_SCHEMA_UIDS.shelterStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shelterSchemaUid"],
        message: "Expected shelter schema must be the fixed Onjung schema",
      });
    }
  });

export type EasVerificationPolicy = Readonly<{
  careSchemaUid: string;
  shelterSchemaUid: string;
  expectedIssuer: string;
}>;

const LookupResultSchema = z
  .object({
    chainId: z.number().int().positive(),
    attestation: z
      .object({
        uid: uidSchema,
        schema: uidSchema,
        attester: addressSchema,
        time: uint64Schema,
        expirationTime: uint64Schema,
        revocationTime: uint64Schema,
        data: encodedDataSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

/** The network boundary is intentionally injectable so verification tests never call a live RPC. */
export interface EasVerificationLookupPort {
  lookup(uid: Bytes32Hex): Promise<unknown>;
}

type SchemaIdentity = Readonly<{
  kind: "CARE_EVENT" | "SHELTER_STATUS";
  label: "CareEvent v1" | "ShelterStatus v1";
  uid: Bytes32Hex;
}>;

export type CareEventVerificationDetails = Readonly<{
  kind: "CARE_EVENT";
  eventType: "방문 돌봄" | "쉼터 체크인" | "보호자 알림 발송";
  riskLevel: "L0 안전" | "L1 관심" | "L2 주의" | "L3 경고" | "L4 위험";
  hriScore: number;
  occurredAt: string;
  subjectHash: Bytes32Hex;
  payloadHash: Bytes32Hex;
}>;

export type ShelterStatusVerificationDetails = Readonly<{
  kind: "SHELTER_STATUS";
  shelterId: string;
  isOpen: boolean;
  crowdLevel: "여유" | "보통" | "혼잡";
  observedAt: string;
  reporterHash: Bytes32Hex;
}>;

type VerifiedAttestationBase = Readonly<{
  network: typeof BASE_SEPOLIA_NETWORK_NAME;
  chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  uid: Bytes32Hex;
  issuer: `0x${string}`;
  issuedAt: string;
  explorerUrl: string;
  schema: SchemaIdentity;
}>;

export type PublicAttestationVerification =
  | Readonly<{ status: "NOT_FOUND" }>
  | Readonly<{ status: "NOT_OURS"; uid: Bytes32Hex }>
  | Readonly<{ status: "TEMPORARY_UNAVAILABLE"; uid: Bytes32Hex }>
  | (VerifiedAttestationBase & Readonly<{ status: "REVOKED"; revokedAt: string }>)
  | (VerifiedAttestationBase &
      Readonly<{
        status: "VERIFIED";
        details: CareEventVerificationDetails | ShelterStatusVerificationDetails;
      }>);

const CARE_ABI_PARAMETERS = parseAbiParameters(
  "bytes32 subjectHash,uint8 eventType,uint8 riskLevel,uint16 hriScore,uint64 occurredAt,bytes32 payloadHash",
);
const SHELTER_ABI_PARAMETERS = parseAbiParameters(
  "string shelterId,bool isOpen,uint8 crowdLevel,uint64 observedAt,bytes32 reporterHash",
);

const EVENT_TYPE_LABEL = ["방문 돌봄", "쉼터 체크인", "보호자 알림 발송"] as const;
const RISK_LEVEL_LABEL = ["L0 안전", "L1 관심", "L2 주의", "L3 경고", "L4 위험"] as const;
const CROWD_LEVEL_LABEL = ["여유", "보통", "혼잡"] as const;

function unixSecondsToIso(value: bigint): string | null {
  if (value < 0n || value > MAX_SUPPORTED_UNIX_SECONDS) return null;
  const milliseconds = Number(value * 1_000n);
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function schemaIdentity(schemaUid: Bytes32Hex, careSchemaUid: Bytes32Hex): SchemaIdentity {
  return schemaUid === careSchemaUid
    ? { kind: "CARE_EVENT", label: "CareEvent v1", uid: schemaUid }
    : { kind: "SHELTER_STATUS", label: "ShelterStatus v1", uid: schemaUid };
}

function decodeCareEvent(data: `0x${string}`): CareEventVerificationDetails | null {
  try {
    const [subjectHash, eventType, riskLevel, hriScore, occurredAt, payloadHash] =
      decodeAbiParameters(CARE_ABI_PARAMETERS, data);
    const parsed = CareEventCodec.parse({
      subjectHash,
      eventType,
      riskLevel,
      hriScore,
      occurredAt,
      payloadHash,
    });
    const occurredAtIso = unixSecondsToIso(parsed.occurredAt);
    if (occurredAtIso === null) return null;

    return {
      kind: "CARE_EVENT",
      eventType: EVENT_TYPE_LABEL[parsed.eventType],
      riskLevel: RISK_LEVEL_LABEL[parsed.riskLevel],
      hriScore: parsed.hriScore,
      occurredAt: occurredAtIso,
      subjectHash: parsed.subjectHash,
      payloadHash: parsed.payloadHash,
    };
  } catch {
    return null;
  }
}

function decodeShelterStatus(data: `0x${string}`): ShelterStatusVerificationDetails | null {
  try {
    const [shelterId, isOpen, crowdLevel, observedAt, reporterHash] = decodeAbiParameters(
      SHELTER_ABI_PARAMETERS,
      data,
    );
    const parsed = ShelterStatusCodec.parse({
      shelterId,
      isOpen,
      crowdLevel,
      observedAt,
      reporterHash,
    });
    const observedAtIso = unixSecondsToIso(parsed.observedAt);
    if (observedAtIso === null) return null;

    return {
      kind: "SHELTER_STATUS",
      shelterId: parsed.shelterId,
      isOpen: parsed.isOpen,
      crowdLevel: CROWD_LEVEL_LABEL[parsed.crowdLevel],
      observedAt: observedAtIso,
      reporterHash: parsed.reporterHash,
    };
  } catch {
    return null;
  }
}

function explorerUrl(uid: Bytes32Hex): string {
  return `${BASE_SEPOLIA_EAS_EXPLORER}/attestation/view/${uid}`;
}

/**
 * Verifies provenance before decoding any public fields. Errors are collapsed
 * into a fixed DTO so RPC URLs, provider messages, and server configuration can
 * never cross the server boundary.
 */
export async function verifyEasAttestation(
  rawUid: unknown,
  rawPolicy: EasVerificationPolicy,
  port: EasVerificationLookupPort,
): Promise<PublicAttestationVerification> {
  let uid: Bytes32Hex;
  try {
    uid = parseEasUid(rawUid);
  } catch {
    return { status: "NOT_FOUND" };
  }

  const policyResult = VerificationPolicySchema.safeParse(rawPolicy);
  if (!policyResult.success) return { status: "TEMPORARY_UNAVAILABLE", uid };
  const policy = policyResult.data;

  let lookupResult: z.infer<typeof LookupResultSchema>;
  try {
    lookupResult = LookupResultSchema.parse(await port.lookup(uid));
  } catch {
    return { status: "TEMPORARY_UNAVAILABLE", uid };
  }

  if (lookupResult.chainId !== BASE_SEPOLIA_CHAIN_ID) return { status: "NOT_OURS", uid };
  const attestation = lookupResult.attestation;
  if (attestation === null || attestation.uid === ZERO_UID) return { status: "NOT_FOUND" };
  if (attestation.uid !== uid) return { status: "NOT_OURS", uid };

  const expectedSchema =
    attestation.schema === policy.careSchemaUid || attestation.schema === policy.shelterSchemaUid;
  if (!expectedSchema || attestation.attester !== policy.expectedIssuer) {
    return { status: "NOT_OURS", uid };
  }

  const issuedAt = unixSecondsToIso(attestation.time);
  if (issuedAt === null) return { status: "NOT_OURS", uid };
  const schema = schemaIdentity(attestation.schema, policy.careSchemaUid);
  const base = {
    network: BASE_SEPOLIA_NETWORK_NAME,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    uid,
    issuer: attestation.attester,
    issuedAt,
    explorerUrl: explorerUrl(uid),
    schema,
  } as const;

  if (attestation.revocationTime > 0n) {
    const revokedAt = unixSecondsToIso(attestation.revocationTime);
    return revokedAt === null
      ? { status: "NOT_OURS", uid }
      : { ...base, status: "REVOKED", revokedAt };
  }

  const details =
    schema.kind === "CARE_EVENT"
      ? decodeCareEvent(attestation.data)
      : decodeShelterStatus(attestation.data);
  if (details === null) return { status: "NOT_OURS", uid };

  return { ...base, status: "VERIFIED", details };
}

const GET_ATTESTATION_ABI = [
  {
    type: "function",
    name: "getAttestation",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "schema", type: "bytes32" },
          { name: "time", type: "uint64" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocationTime", type: "uint64" },
          { name: "refUID", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
] as const;

/** Production Base Sepolia EAS reader. The RPC URL remains captured server-side. */
export function createBaseSepoliaEasLookupPort(rpcUrl: string): EasVerificationLookupPort {
  const parsedUrl = z.string().trim().url().parse(rpcUrl);
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(parsedUrl, { retryCount: 0, timeout: 15_000 }),
  });

  return {
    async lookup(uid) {
      const [chainId, attestation] = await Promise.all([
        client.getChainId(),
        client.readContract({
          address: BASE_SEPOLIA_EAS_ADDRESS,
          abi: GET_ATTESTATION_ABI,
          functionName: "getAttestation",
          args: [uid],
        }),
      ]);
      const found = attestation.uid.toLowerCase() === ZERO_UID ? null : attestation;
      return {
        chainId,
        attestation:
          found === null
            ? null
            : {
                uid: found.uid,
                schema: found.schema,
                attester: found.attester,
                time: found.time,
                expirationTime: found.expirationTime,
                revocationTime: found.revocationTime,
                data: found.data,
              },
      };
    },
  };
}
