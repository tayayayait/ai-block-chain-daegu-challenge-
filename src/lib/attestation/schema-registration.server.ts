import "@tanstack/react-start/server-only";

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { z } from "zod";

import { CARE_EVENT_SCHEMA, SHELTER_STATUS_SCHEMA } from "./schemas";
import { computeRequiredSchemaUids, type RequiredSchemaUids } from "./schema-uids.server";
import {
  BASE_SEPOLIA_CHAIN_ID,
  EasClientError,
  parseEasStartupConfig,
  type EasStartupConfig,
} from "./eas.server";

export const BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS =
  "0x4200000000000000000000000000000000000020" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_UID = `0x${"0".repeat(64)}` as `0x${string}`;

const Bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/iu)
  .transform((value) => value.toLowerCase() as `0x${string}`);
const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/iu)
  .transform((value) => value.toLowerCase() as Address);

export interface SchemaRegistrationConfig extends EasStartupConfig {
  readonly registryAddress: typeof BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS;
}

export type SchemaRegistrationErrorCode =
  | "INVALID_CONFIG"
  | "CONFIG_UID_MISMATCH"
  | "INVALID_CHAIN"
  | "PREFLIGHT_FAILED"
  | "SCHEMA_CONFLICT"
  | "SUBMISSION_FAILED"
  | "CONFIRMATION_UNCERTAIN"
  | "TRANSACTION_REVERTED"
  | "INVALID_RECEIPT";

/** Error text is intentionally limited to a stable code; provider details are discarded. */
export class SchemaRegistrationError extends Error {
  constructor(readonly code: SchemaRegistrationErrorCode) {
    super(code);
    this.name = "SchemaRegistrationError";
  }
}

export { computeRequiredSchemaUids } from "./schema-uids.server";
export type { RequiredSchemaUids } from "./schema-uids.server";

export function parseSchemaRegistrationConfig(
  environment: Record<string, unknown>,
): SchemaRegistrationConfig {
  const expected = computeRequiredSchemaUids();
  const configuredCare = environment["EAS_CARE_SCHEMA_UID"];
  const configuredShelter = environment["EAS_SHELTER_SCHEMA_UID"];
  if (
    (configuredCare !== undefined &&
      (typeof configuredCare !== "string" ||
        configuredCare.toLowerCase() !== expected.careEvent)) ||
    (configuredShelter !== undefined &&
      (typeof configuredShelter !== "string" ||
        configuredShelter.toLowerCase() !== expected.shelterStatus))
  ) {
    throw new SchemaRegistrationError("CONFIG_UID_MISMATCH");
  }

  let base: EasStartupConfig;
  try {
    base = parseEasStartupConfig({
      ...environment,
      EAS_CARE_SCHEMA_UID: expected.careEvent,
      EAS_SHELTER_SCHEMA_UID: expected.shelterStatus,
    });
  } catch (error) {
    if (error instanceof EasClientError) {
      throw new SchemaRegistrationError("INVALID_CONFIG");
    }
    throw new SchemaRegistrationError("INVALID_CONFIG");
  }
  return Object.freeze({ ...base, registryAddress: BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS });
}

export interface RegisteredSchemaRecord {
  readonly uid: `0x${string}`;
  readonly schema: string;
  readonly resolver: Address;
  readonly revocable: boolean;
}

export interface SubmitSchemaRegistrationRequest {
  readonly registryAddress: typeof BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS;
  readonly schema: string;
  readonly resolver: typeof ZERO_ADDRESS;
  readonly revocable: true;
  readonly expectedUid: `0x${string}`;
}

export interface SchemaRegistrationReceipt {
  readonly status: "success" | "reverted";
  readonly transactionHash: `0x${string}`;
  readonly registrations: readonly Readonly<{
    uid: `0x${string}`;
    issuer: Address;
  }>[];
}

export interface SchemaRegistryPort {
  getChainId(): Promise<number>;
  getSchema(uid: `0x${string}`): Promise<RegisteredSchemaRecord | null>;
  submitRegistration(request: SubmitSchemaRegistrationRequest): Promise<`0x${string}`>;
  waitForRegistration(
    transactionHash: `0x${string}`,
    expectedUid: `0x${string}`,
  ): Promise<SchemaRegistrationReceipt>;
}

const SCHEMA_REGISTRY_ABI = parseAbi([
  "function getSchema(bytes32 uid) view returns ((bytes32 uid,address resolver,bool revocable,string schema))",
  "function register(string schema,address resolver,bool revocable) returns (bytes32)",
  "event Registered(bytes32 indexed uid,address indexed registerer,(bytes32 uid,address resolver,bool revocable,string schema) schema)",
]);

export function createViemSchemaRegistryPort(config: SchemaRegistrationConfig): SchemaRegistryPort {
  const account = privateKeyToAccount(config.privateKey);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  });

  const port: SchemaRegistryPort = {
    async getChainId() {
      return publicClient.getChainId();
    },

    async getSchema(uid) {
      const record = await publicClient.readContract({
        address: BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS,
        abi: SCHEMA_REGISTRY_ABI,
        functionName: "getSchema",
        args: [uid],
      });
      if (record.uid === ZERO_UID && record.schema === "") return null;
      return Object.freeze({
        uid: Bytes32Schema.parse(record.uid),
        resolver: AddressSchema.parse(record.resolver),
        revocable: record.revocable,
        schema: record.schema,
      });
    },

    async submitRegistration(request) {
      let simulation;
      try {
        simulation = await publicClient.simulateContract({
          account,
          address: request.registryAddress,
          abi: SCHEMA_REGISTRY_ABI,
          functionName: "register",
          args: [request.schema, request.resolver, request.revocable],
        });
      } catch {
        throw new SchemaRegistrationError("SUBMISSION_FAILED");
      }
      try {
        return await walletClient.writeContract(simulation.request);
      } catch {
        throw new SchemaRegistrationError("CONFIRMATION_UNCERTAIN");
      }
    },

    async waitForRegistration(transactionHash) {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        confirmations: 1,
      });
      const logs = parseEventLogs({
        abi: SCHEMA_REGISTRY_ABI,
        eventName: "Registered",
        logs: receipt.logs,
        strict: false,
      });
      const registrations: Array<Readonly<{ uid: `0x${string}`; issuer: Address }>> = [];
      for (const log of logs) {
        const { registerer, uid } = log.args;
        if (!registerer || !uid) continue;
        registrations.push(
          Object.freeze({
            uid: Bytes32Schema.parse(uid),
            issuer: AddressSchema.parse(registerer),
          }),
        );
      }
      return Object.freeze({
        status: receipt.status,
        transactionHash: Bytes32Schema.parse(receipt.transactionHash),
        registrations: Object.freeze(registrations),
      });
    },
  };
  return Object.freeze(port);
}

export interface RegisteredSchemaResult {
  readonly kind: "CARE_EVENT" | "SHELTER_STATUS";
  readonly status: "ALREADY_REGISTERED" | "REGISTERED";
  readonly uid: `0x${string}`;
  readonly transactionHash: `0x${string}` | null;
}

export interface SchemaRegistrationResult {
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly registryAddress: typeof BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS;
  readonly issuer: Address;
  readonly schemas: readonly RegisteredSchemaResult[];
}

export interface SchemaRegistrationService {
  registerRequiredSchemas(): Promise<SchemaRegistrationResult>;
}

const ExistingRecordSchema = z
  .object({
    uid: Bytes32Schema,
    schema: z.string(),
    resolver: AddressSchema,
    revocable: z.boolean(),
  })
  .strict();
const ReceiptSchema = z
  .object({
    status: z.enum(["success", "reverted"]),
    transactionHash: Bytes32Schema,
    registrations: z.array(z.object({ uid: Bytes32Schema, issuer: AddressSchema }).strict()),
  })
  .strict();

export function createSchemaRegistrationService(input: {
  readonly config: SchemaRegistrationConfig;
  readonly port?: SchemaRegistryPort;
}): SchemaRegistrationService {
  const port = input.port ?? createViemSchemaRegistryPort(input.config);
  const required = Object.freeze([
    Object.freeze({
      kind: "CARE_EVENT" as const,
      schema: CARE_EVENT_SCHEMA,
      uid: input.config.careSchemaUid,
    }),
    Object.freeze({
      kind: "SHELTER_STATUS" as const,
      schema: SHELTER_STATUS_SCHEMA,
      uid: input.config.shelterSchemaUid,
    }),
  ]);
  let once: Promise<SchemaRegistrationResult> | undefined;

  const run = async (): Promise<SchemaRegistrationResult> => {
    let chainId: number;
    try {
      chainId = await port.getChainId();
    } catch {
      throw new SchemaRegistrationError("PREFLIGHT_FAILED");
    }
    if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
      throw new SchemaRegistrationError("INVALID_CHAIN");
    }

    const results: RegisteredSchemaResult[] = [];
    for (const item of required) {
      let existing: RegisteredSchemaRecord | null;
      try {
        const raw = await port.getSchema(item.uid);
        existing = raw === null ? null : ExistingRecordSchema.parse(raw);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new SchemaRegistrationError("SCHEMA_CONFLICT");
        }
        throw new SchemaRegistrationError("PREFLIGHT_FAILED");
      }
      if (existing !== null) {
        if (
          existing.uid !== item.uid ||
          existing.schema !== item.schema ||
          existing.resolver !== ZERO_ADDRESS ||
          !existing.revocable
        ) {
          throw new SchemaRegistrationError("SCHEMA_CONFLICT");
        }
        results.push(
          Object.freeze({
            kind: item.kind,
            status: "ALREADY_REGISTERED",
            uid: item.uid,
            transactionHash: null,
          }),
        );
        continue;
      }

      let transactionHash: `0x${string}`;
      try {
        transactionHash = Bytes32Schema.parse(
          await port.submitRegistration({
            registryAddress: BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS,
            schema: item.schema,
            resolver: ZERO_ADDRESS,
            revocable: true,
            expectedUid: item.uid,
          }),
        );
      } catch (error) {
        if (error instanceof SchemaRegistrationError) throw error;
        throw new SchemaRegistrationError("SUBMISSION_FAILED");
      }

      let receipt: z.output<typeof ReceiptSchema>;
      try {
        receipt = ReceiptSchema.parse(await port.waitForRegistration(transactionHash, item.uid));
      } catch (error) {
        if (error instanceof SchemaRegistrationError) throw error;
        throw new SchemaRegistrationError("CONFIRMATION_UNCERTAIN");
      }
      if (receipt.status !== "success") {
        throw new SchemaRegistrationError("TRANSACTION_REVERTED");
      }
      const registration = receipt.registrations[0];
      if (
        receipt.transactionHash !== transactionHash ||
        receipt.registrations.length !== 1 ||
        !registration ||
        registration.uid !== item.uid ||
        registration.issuer !== input.config.issuer
      ) {
        throw new SchemaRegistrationError("INVALID_RECEIPT");
      }
      results.push(
        Object.freeze({
          kind: item.kind,
          status: "REGISTERED",
          uid: item.uid,
          transactionHash,
        }),
      );
    }

    return Object.freeze({
      chainId: BASE_SEPOLIA_CHAIN_ID,
      registryAddress: BASE_SEPOLIA_SCHEMA_REGISTRY_ADDRESS,
      issuer: input.config.issuer,
      schemas: Object.freeze(results),
    });
  };

  return Object.freeze({
    registerRequiredSchemas() {
      once ??= run();
      return once;
    },
  });
}

/** JSON suitable for an operator console; private key and RPC URL are not accepted as input. */
export function formatSchemaRegistrationResult(result: SchemaRegistrationResult): string {
  return JSON.stringify({
    chainId: result.chainId,
    network: "Base Sepolia testnet",
    registryAddress: result.registryAddress,
    issuer: result.issuer,
    schemas: result.schemas.map((schema) => ({
      kind: schema.kind,
      status: schema.status,
      uid: schema.uid,
      transactionHash: schema.transactionHash,
    })),
  });
}
