import { SchemaEncoder } from "@ethereum-attestation-service/eas-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

import { CARE_EVENT_SCHEMA, type CareEventValue } from "./schemas";
import { computeRequiredSchemaUids } from "./schema-registration.server";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_EAS_ADDRESS,
  EasClientError,
  createEasAttestationClient,
  parseEasStartupConfig,
  type EasChainPort,
} from "./eas.server";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as const;
const ISSUER = privateKeyToAccount(PRIVATE_KEY).address;
const REQUIRED_SCHEMA_UIDS = computeRequiredSchemaUids();
const CARE_SCHEMA_UID = REQUIRED_SCHEMA_UIDS.careEvent;
const SHELTER_SCHEMA_UID = REQUIRED_SCHEMA_UIDS.shelterStatus;
const TX_HASH = `0x${"cc".repeat(32)}` as const;
const ATTESTATION_UID = `0x${"dd".repeat(32)}` as const;

const environment = {
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.example",
  EAS_ATTESTER_PRIVATE_KEY: PRIVATE_KEY,
  EAS_CARE_SCHEMA_UID: CARE_SCHEMA_UID,
  EAS_SHELTER_SCHEMA_UID: SHELTER_SCHEMA_UID,
  EAS_EXPECTED_ISSUER: ISSUER,
};

const careValue: CareEventValue = {
  subjectHash: `0x${"01".repeat(32)}`,
  eventType: 2,
  riskLevel: 3,
  hriScore: 72,
  occurredAt: 1_787_532_000n,
  payloadHash: `0x${"02".repeat(32)}`,
};

const createPort = (overrides: Partial<EasChainPort> = {}): EasChainPort => ({
  getChainId: async () => BASE_SEPOLIA_CHAIN_ID,
  submitAttestation: async () => TX_HASH,
  waitForAttestation: async () => ({
    status: "success",
    transactionHash: TX_HASH,
    attestations: [
      {
        uid: ATTESTATION_UID,
        schemaUid: CARE_SCHEMA_UID,
        issuer: ISSUER,
      },
    ],
  }),
  ...overrides,
});

describe("Base Sepolia EAS startup configuration", () => {
  it("accepts only complete, internally consistent Base Sepolia configuration", () => {
    const config = parseEasStartupConfig(environment);

    expect(config).toMatchObject({
      chainId: 84532,
      easAddress: BASE_SEPOLIA_EAS_ADDRESS,
      issuer: ISSUER.toLowerCase(),
      careSchemaUid: CARE_SCHEMA_UID,
      shelterSchemaUid: SHELTER_SCHEMA_UID,
    });
  });

  it.each([
    [{ ...environment, BASE_SEPOLIA_RPC_URL: undefined }],
    [{ ...environment, BASE_SEPOLIA_RPC_URL: "http://unsafe.example" }],
    [{ ...environment, EAS_CARE_SCHEMA_UID: "not-a-uid" }],
    [{ ...environment, EAS_SHELTER_SCHEMA_UID: CARE_SCHEMA_UID }],
    [{ ...environment, EAS_EXPECTED_ISSUER: `0x${"12".repeat(20)}` }],
  ])("rejects missing or unsafe startup values without echoing them", (candidate) => {
    let error: unknown;
    try {
      parseEasStartupConfig(candidate);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "INVALID_CONFIG", message: "INVALID_CONFIG" });
    expect(JSON.stringify(error)).not.toContain(PRIVATE_KEY);
  });

  it("rejects syntactically valid schema UIDs that are not the fixed Onjung schemas", () => {
    expect(() =>
      parseEasStartupConfig({
        ...environment,
        EAS_CARE_SCHEMA_UID: `0x${"aa".repeat(32)}`,
        EAS_SHELTER_SCHEMA_UID: `0x${"bb".repeat(32)}`,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIG" }));
  });
});

describe("EAS attestation client", () => {
  it("returns a durable transaction hash before waiting for its receipt", async () => {
    const waitForAttestation = vi.fn(createPort().waitForAttestation);
    const client = createEasAttestationClient({
      config: parseEasStartupConfig(environment),
      port: createPort({ waitForAttestation }),
      now: () => new Date("2026-08-24T00:00:03.000Z"),
    });

    const submission = await client.submit({
      schemaKind: "CARE_EVENT",
      value: careValue,
      idempotencyKey: "care-event:durable-hash",
      existingAttestationUid: null,
    });

    expect(submission).toEqual({
      transactionHash: TX_HASH,
      chainId: 84532,
      schemaUid: CARE_SCHEMA_UID,
      issuer: ISSUER.toLowerCase(),
    });
    expect(waitForAttestation).not.toHaveBeenCalled();
    await expect(client.confirm(submission)).resolves.toMatchObject({
      attestationUid: ATTESTATION_UID,
      transactionHash: TX_HASH,
    });
    expect(waitForAttestation).toHaveBeenCalledWith(TX_HASH);
  });

  it("strictly encodes the fixed schema, confirms the receipt, and returns its UID", async () => {
    const captured: unknown[] = [];
    const port = createPort({
      submitAttestation: async (request) => {
        captured.push(request);
        return TX_HASH;
      },
    });
    const client = createEasAttestationClient({
      config: parseEasStartupConfig(environment),
      port,
      now: () => new Date("2026-08-24T00:00:03.000Z"),
    });

    await expect(
      client.attest({
        schemaKind: "CARE_EVENT",
        value: careValue,
        idempotencyKey: "care-event:123e4567-e89b-42d3-a456-426614174000",
        existingAttestationUid: null,
      }),
    ).resolves.toEqual({
      attestationUid: ATTESTATION_UID,
      transactionHash: TX_HASH,
      chainId: 84532,
      schemaUid: CARE_SCHEMA_UID,
      issuer: ISSUER.toLowerCase(),
      verifiedAt: "2026-08-24T00:00:03.000Z",
    });

    const request = captured[0] as {
      encodedData: string;
      contractAddress: string;
      revocable: boolean;
    };
    expect(request.contractAddress).toBe(BASE_SEPOLIA_EAS_ADDRESS);
    expect(request.revocable).toBe(true);
    expect(new SchemaEncoder(CARE_EVENT_SCHEMA).decodeData(request.encodedData)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "eventType",
          value: expect.objectContaining({ value: 2n }),
        }),
        expect.objectContaining({
          name: "hriScore",
          value: expect.objectContaining({ value: 72n }),
        }),
      ]),
    );
  });

  it("refuses an already-attested target before any chain call", async () => {
    const getChainId = vi.fn(async () => BASE_SEPOLIA_CHAIN_ID);
    const submitAttestation = vi.fn(async () => TX_HASH);
    const client = createEasAttestationClient({
      config: parseEasStartupConfig(environment),
      port: createPort({ getChainId, submitAttestation }),
    });

    await expect(
      client.attest({
        schemaKind: "CARE_EVENT",
        value: careValue,
        idempotencyKey: "care-event:already",
        existingAttestationUid: ATTESTATION_UID,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_ATTESTED", retryable: false });
    expect(getChainId).not.toHaveBeenCalled();
    expect(submitAttestation).not.toHaveBeenCalled();
  });

  it("coalesces concurrent retries with the same idempotency key and rejects a payload collision", async () => {
    const submitAttestation = vi.fn(async () => TX_HASH);
    const client = createEasAttestationClient({
      config: parseEasStartupConfig(environment),
      port: createPort({ submitAttestation }),
    });
    const request = {
      schemaKind: "CARE_EVENT" as const,
      value: careValue,
      idempotencyKey: "care-event:one-logical-event",
      existingAttestationUid: null,
    };

    const [first, second] = await Promise.all([client.attest(request), client.attest(request)]);

    expect(first).toEqual(second);
    expect(submitAttestation).toHaveBeenCalledTimes(1);
    await expect(
      client.attest({ ...request, value: { ...careValue, hriScore: 71 } }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", retryable: false });
    expect(submitAttestation).toHaveBeenCalledTimes(1);
  });

  it("never writes when the RPC chain is not Base Sepolia", async () => {
    const submitAttestation = vi.fn(async () => TX_HASH);
    const client = createEasAttestationClient({
      config: parseEasStartupConfig(environment),
      port: createPort({ getChainId: async () => 1, submitAttestation }),
    });

    await expect(
      client.attest({
        schemaKind: "CARE_EVENT",
        value: careValue,
        idempotencyKey: "care-event:wrong-chain",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CHAIN", retryable: false });
    expect(submitAttestation).not.toHaveBeenCalled();
  });

  it.each([
    [
      "reverted receipt",
      createPort({
        waitForAttestation: async () => ({
          status: "reverted",
          transactionHash: TX_HASH,
          attestations: [],
        }),
      }),
      "TRANSACTION_REVERTED",
    ],
    [
      "wrong schema event",
      createPort({
        waitForAttestation: async () => ({
          status: "success",
          transactionHash: TX_HASH,
          attestations: [{ uid: ATTESTATION_UID, schemaUid: SHELTER_SCHEMA_UID, issuer: ISSUER }],
        }),
      }),
      "INVALID_RECEIPT",
    ],
    [
      "wrong issuer event",
      createPort({
        waitForAttestation: async () => ({
          status: "success",
          transactionHash: TX_HASH,
          attestations: [
            {
              uid: ATTESTATION_UID,
              schemaUid: CARE_SCHEMA_UID,
              issuer: `0x${"12".repeat(20)}`,
            },
          ],
        }),
      }),
      "INVALID_RECEIPT",
    ],
  ])("rejects a %s", async (_name, port, code) => {
    const client = createEasAttestationClient({
      config: parseEasStartupConfig(environment),
      port,
    });

    await expect(
      client.attest({
        schemaKind: "CARE_EVENT",
        value: careValue,
        idempotencyKey: "care-event:receipt-check",
      }),
    ).rejects.toMatchObject({ code, retryable: false });
  });

  it("marks only a pre-submission transport error retryable and treats confirmation uncertainty as permanent", async () => {
    const beforeSubmit = createEasAttestationClient({
      config: parseEasStartupConfig(environment),
      port: createPort({
        submitAttestation: async () => {
          throw new Error("rpc secret and wallet data");
        },
      }),
    });
    const afterSubmit = createEasAttestationClient({
      config: parseEasStartupConfig(environment),
      port: createPort({
        waitForAttestation: async () => {
          throw new Error("receipt service unavailable");
        },
      }),
    });

    await expect(
      beforeSubmit.attest({
        schemaKind: "CARE_EVENT",
        value: careValue,
        idempotencyKey: "care-event:before",
      }),
    ).rejects.toMatchObject({
      code: "SUBMISSION_TEMPORARY",
      retryable: true,
      message: "SUBMISSION_TEMPORARY",
    });
    await expect(
      afterSubmit.attest({
        schemaKind: "CARE_EVENT",
        value: careValue,
        idempotencyKey: "care-event:after",
      }),
    ).rejects.toMatchObject({
      code: "CONFIRMATION_UNCERTAIN",
      retryable: false,
      message: "CONFIRMATION_UNCERTAIN",
    });
  });

  it("maps malformed values to a stable non-sensitive permanent error", async () => {
    const client = createEasAttestationClient({
      config: parseEasStartupConfig(environment),
      port: createPort(),
    });
    const result = client
      .attest({
        schemaKind: "CARE_EVENT",
        value: { ...careValue, hriScore: 101, patientName: "private" },
        idempotencyKey: "care-event:invalid",
      })
      .catch((error: unknown) => error);

    await expect(result).resolves.toBeInstanceOf(EasClientError);
    await expect(result).resolves.toMatchObject({
      code: "INVALID_PAYLOAD",
      retryable: false,
      message: "INVALID_PAYLOAD",
    });
    expect(JSON.stringify(await result)).not.toContain("private");
  });
});
