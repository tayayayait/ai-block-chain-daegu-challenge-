import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

import { CARE_EVENT_SCHEMA, SHELTER_STATUS_SCHEMA } from "./schemas";
import {
  BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS,
  SchemaRegistrationError,
  computeRequiredSchemaUids,
  createSchemaRegistrationService,
  formatSchemaRegistrationResult,
  parseSchemaRegistrationConfig,
  type SchemaRegistryPort,
} from "./schema-registration.server";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as const;
const ISSUER = privateKeyToAccount(PRIVATE_KEY).address.toLowerCase() as `0x${string}`;
const TX_HASH = `0x${"cc".repeat(32)}` as const;
const UIDS = computeRequiredSchemaUids();

const environment = {
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.example",
  EAS_ATTESTER_PRIVATE_KEY: PRIVATE_KEY,
  EAS_EXPECTED_ISSUER: ISSUER,
  EAS_CARE_SCHEMA_UID: UIDS.careEvent,
  EAS_SHELTER_SCHEMA_UID: UIDS.shelterStatus,
};

const existingRecord = (uid: `0x${string}`, schema: string) => ({
  uid,
  schema,
  resolver: "0x0000000000000000000000000000000000000000" as const,
  revocable: true,
});

const portWith = (overrides: Partial<SchemaRegistryPort> = {}): SchemaRegistryPort => ({
  getChainId: async () => 84532,
  getSchema: async () => null,
  submitRegistration: async () => TX_HASH,
  waitForRegistration: async (_transactionHash, expectedUid) => ({
    status: "success",
    transactionHash: TX_HASH,
    registrations: [{ uid: expectedUid, issuer: ISSUER }],
  }),
  ...overrides,
});

describe("one-time Base Sepolia EAS schema registration", () => {
  it("computes fixed deterministic UIDs and validates optional configured UIDs", () => {
    expect(UIDS.careEvent).toMatch(/^0x[0-9a-f]{64}$/);
    expect(UIDS.shelterStatus).toMatch(/^0x[0-9a-f]{64}$/);
    expect(UIDS.careEvent).not.toBe(UIDS.shelterStatus);
    expect(parseSchemaRegistrationConfig(environment)).toMatchObject({
      chainId: 84532,
      registryAddress: BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS,
      issuer: ISSUER,
      careSchemaUid: UIDS.careEvent,
      shelterSchemaUid: UIDS.shelterStatus,
    });

    expect(() =>
      parseSchemaRegistrationConfig({
        ...environment,
        EAS_CARE_SCHEMA_UID: `0x${"a".repeat(64)}`,
      }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_UID_MISMATCH" }));
  });

  it("does not submit either schema when exact records already exist", async () => {
    const submitRegistration = vi.fn<SchemaRegistryPort["submitRegistration"]>();
    const port = portWith({
      getSchema: async (uid) =>
        uid === UIDS.careEvent
          ? existingRecord(uid, CARE_EVENT_SCHEMA)
          : existingRecord(uid, SHELTER_STATUS_SCHEMA),
      submitRegistration,
    });
    const service = createSchemaRegistrationService({
      config: parseSchemaRegistrationConfig(environment),
      port,
    });

    await expect(service.registerRequiredSchemas()).resolves.toEqual({
      chainId: 84532,
      registryAddress: BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS,
      issuer: ISSUER,
      schemas: [
        {
          kind: "CARE_EVENT",
          status: "ALREADY_REGISTERED",
          uid: UIDS.careEvent,
          transactionHash: null,
        },
        {
          kind: "SHELTER_STATUS",
          status: "ALREADY_REGISTERED",
          uid: UIDS.shelterStatus,
          transactionHash: null,
        },
      ],
    });
    expect(submitRegistration).not.toHaveBeenCalled();
  });

  it("registers only a missing schema and verifies its receipt UID and issuer", async () => {
    const submissions: unknown[] = [];
    const port = portWith({
      getSchema: async (uid) =>
        uid === UIDS.careEvent ? existingRecord(uid, CARE_EVENT_SCHEMA) : null,
      submitRegistration: async (request) => {
        submissions.push(request);
        return TX_HASH;
      },
    });
    const service = createSchemaRegistrationService({
      config: parseSchemaRegistrationConfig(environment),
      port,
    });

    const result = await service.registerRequiredSchemas();

    expect(submissions).toEqual([
      {
        registryAddress: BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS,
        schema: SHELTER_STATUS_SCHEMA,
        resolver: "0x0000000000000000000000000000000000000000",
        revocable: true,
        expectedUid: UIDS.shelterStatus,
      },
    ]);
    expect(result.schemas[1]).toEqual({
      kind: "SHELTER_STATUS",
      status: "REGISTERED",
      uid: UIDS.shelterStatus,
      transactionHash: TX_HASH,
    });
  });

  it.each([
    ["wrong chain", portWith({ getChainId: async () => 1 }), "INVALID_CHAIN"],
    [
      "conflicting preflight record",
      portWith({
        getSchema: async (uid) => existingRecord(uid, "string privateData"),
      }),
      "SCHEMA_CONFLICT",
    ],
    [
      "wrong receipt issuer",
      portWith({
        waitForRegistration: async (_tx, expectedUid) => ({
          status: "success",
          transactionHash: TX_HASH,
          registrations: [{ uid: expectedUid, issuer: `0x${"12".repeat(20)}` as `0x${string}` }],
        }),
      }),
      "INVALID_RECEIPT",
    ],
  ])("rejects %s without attempting unsafe follow-up", async (_name, port, code) => {
    const service = createSchemaRegistrationService({
      config: parseSchemaRegistrationConfig(environment),
      port,
    });

    await expect(service.registerRequiredSchemas()).rejects.toMatchObject({ code });
  });

  it("formats only public registration metadata and cannot leak startup secrets", async () => {
    const service = createSchemaRegistrationService({
      config: parseSchemaRegistrationConfig(environment),
      port: portWith(),
    });
    const formatted = formatSchemaRegistrationResult(await service.registerRequiredSchemas());

    expect(() => JSON.parse(formatted)).not.toThrow();
    expect(formatted).toContain(UIDS.careEvent);
    expect(formatted).toContain(TX_HASH);
    expect(formatted).toContain(ISSUER);
    expect(formatted).not.toContain(PRIVATE_KEY);
    expect(formatted).not.toContain(environment.BASE_SEPOLIA_RPC_URL);
  });

  it("uses stable errors that never include a wallet or RPC failure payload", async () => {
    const service = createSchemaRegistrationService({
      config: parseSchemaRegistrationConfig(environment),
      port: portWith({
        submitRegistration: async () => {
          throw new Error(`private=${PRIVATE_KEY}`);
        },
      }),
    });

    const error = await service.registerRequiredSchemas().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SchemaRegistrationError);
    expect(error).toMatchObject({ code: "SUBMISSION_FAILED", message: "SUBMISSION_FAILED" });
    expect(JSON.stringify(error)).not.toContain(PRIVATE_KEY);
  });
});
