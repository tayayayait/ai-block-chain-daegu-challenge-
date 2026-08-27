import "@tanstack/react-start/server-only";

import { SchemaEncoder, type SchemaItem } from "@ethereum-attestation-service/eas-sdk";
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

import {
  CARE_EVENT_SCHEMA,
  CareEventCodec,
  SHELTER_STATUS_SCHEMA,
  ShelterStatusCodec,
  parseEasUid,
  type EasAttestationUid,
} from "./schemas";
import { REQUIRED_EAS_SCHEMA_UIDS } from "./schema-uids.server";

export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_SEPOLIA_EAS_ADDRESS = "0x4200000000000000000000000000000000000021" as const;

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
const TransactionHashSchema = Bytes32Schema;
const PrivateKeySchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/iu)
  .transform((value) => value.toLowerCase() as Hex);
const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:");

const EasEnvironmentSchema = z
  .object({
    BASE_SEPOLIA_RPC_URL: HttpsUrlSchema,
    EAS_ATTESTER_PRIVATE_KEY: PrivateKeySchema,
    EAS_CARE_SCHEMA_UID: Bytes32Schema,
    EAS_SHELTER_SCHEMA_UID: Bytes32Schema,
    EAS_EXPECTED_ISSUER: AddressSchema,
  })
  .superRefine((value, context) => {
    if (value.EAS_CARE_SCHEMA_UID === value.EAS_SHELTER_SCHEMA_UID) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EAS_SHELTER_SCHEMA_UID"],
        message: "schema identifiers must be distinct",
      });
    }

    if (value.EAS_CARE_SCHEMA_UID !== REQUIRED_EAS_SCHEMA_UIDS.careEvent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EAS_CARE_SCHEMA_UID"],
        message: "care schema identifier must match the fixed Onjung schema",
      });
    }

    if (value.EAS_SHELTER_SCHEMA_UID !== REQUIRED_EAS_SCHEMA_UIDS.shelterStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EAS_SHELTER_SCHEMA_UID"],
        message: "shelter schema identifier must match the fixed Onjung schema",
      });
    }

    const derivedIssuer = privateKeyToAccount(value.EAS_ATTESTER_PRIVATE_KEY).address.toLowerCase();
    if (derivedIssuer !== value.EAS_EXPECTED_ISSUER) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EAS_EXPECTED_ISSUER"],
        message: "issuer must match the configured attester",
      });
    }
  });

export interface EasStartupConfig {
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly easAddress: typeof BASE_SEPOLIA_EAS_ADDRESS;
  readonly rpcUrl: string;
  readonly privateKey: Hex;
  readonly issuer: Address;
  readonly careSchemaUid: `0x${string}`;
  readonly shelterSchemaUid: `0x${string}`;
}

export type EasClientErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_CHAIN"
  | "INVALID_PAYLOAD"
  | "IDEMPOTENCY_CONFLICT"
  | "ALREADY_ATTESTED"
  | "SUBMISSION_TEMPORARY"
  | "CONFIRMATION_UNCERTAIN"
  | "TRANSACTION_REVERTED"
  | "INVALID_RECEIPT";

/** Stable errors never interpolate an RPC response, payload, identifier, or private key. */
export class EasClientError extends Error {
  constructor(
    readonly code: EasClientErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "EasClientError";
  }
}

export function parseEasStartupConfig(environment: Record<string, unknown>): EasStartupConfig {
  const parsed = EasEnvironmentSchema.safeParse(environment);
  if (!parsed.success) throw new EasClientError("INVALID_CONFIG", false);

  return Object.freeze({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    easAddress: BASE_SEPOLIA_EAS_ADDRESS,
    rpcUrl: parsed.data.BASE_SEPOLIA_RPC_URL,
    privateKey: parsed.data.EAS_ATTESTER_PRIVATE_KEY,
    issuer: parsed.data.EAS_EXPECTED_ISSUER,
    careSchemaUid: parsed.data.EAS_CARE_SCHEMA_UID,
    shelterSchemaUid: parsed.data.EAS_SHELTER_SCHEMA_UID,
  });
}

export interface EasSubmitRequest {
  readonly contractAddress: typeof BASE_SEPOLIA_EAS_ADDRESS;
  readonly schemaUid: `0x${string}`;
  readonly encodedData: Hex;
  readonly revocable: true;
}

export interface EasReceiptAttestation {
  readonly uid: `0x${string}`;
  readonly schemaUid: `0x${string}`;
  readonly issuer: Address;
}

export interface EasAttestationReceipt {
  readonly status: "success" | "reverted";
  readonly transactionHash: `0x${string}`;
  readonly attestations: readonly EasReceiptAttestation[];
}

export interface EasChainPort {
  getChainId(): Promise<number>;
  submitAttestation(request: EasSubmitRequest): Promise<`0x${string}`>;
  waitForAttestation(transactionHash: `0x${string}`): Promise<EasAttestationReceipt>;
}

/** Signals that a wallet write may have reached the RPC despite no hash response. */
export class EasSubmissionUncertainError extends Error {
  constructor() {
    super("SUBMISSION_UNCERTAIN");
    this.name = "EasSubmissionUncertainError";
  }
}

const EAS_ABI = parseAbi([
  "function attest((bytes32 schema,(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value) data) request) payable returns (bytes32)",
  "event Attested(address indexed recipient,address indexed attester,bytes32 uid,bytes32 indexed schemaUID)",
]);

export function createViemEasChainPort(config: EasStartupConfig): EasChainPort {
  const account = privateKeyToAccount(config.privateKey);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  });

  const port: EasChainPort = {
    async getChainId() {
      return publicClient.getChainId();
    },

    async submitAttestation(request: EasSubmitRequest) {
      let simulation;
      try {
        simulation = await publicClient.simulateContract({
          account,
          address: request.contractAddress,
          abi: EAS_ABI,
          functionName: "attest",
          args: [
            {
              schema: request.schemaUid,
              data: {
                recipient: ZERO_ADDRESS,
                expirationTime: 0n,
                revocable: request.revocable,
                refUID: ZERO_UID,
                data: request.encodedData,
                value: 0n,
              },
            },
          ],
          value: 0n,
        });
      } catch {
        throw new EasClientError("SUBMISSION_TEMPORARY", true);
      }

      try {
        return await walletClient.writeContract(simulation.request);
      } catch {
        throw new EasSubmissionUncertainError();
      }
    },

    async waitForAttestation(transactionHash: `0x${string}`) {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        confirmations: 1,
      });
      const logs = parseEventLogs({
        abi: EAS_ABI,
        eventName: "Attested",
        logs: receipt.logs,
        strict: false,
      });
      const attestations: EasReceiptAttestation[] = [];
      for (const log of logs) {
        const { attester, schemaUID, uid } = log.args;
        if (!attester || !schemaUID || !uid) continue;
        attestations.push(
          Object.freeze({
            uid,
            schemaUid: schemaUID,
            issuer: attester.toLowerCase() as Address,
          }),
        );
      }
      return Object.freeze({
        status: receipt.status,
        transactionHash: receipt.transactionHash,
        attestations: Object.freeze(attestations),
      });
    },
  };
  return Object.freeze(port);
}

const AttestationInputSchema = z.discriminatedUnion("schemaKind", [
  z
    .object({
      schemaKind: z.literal("CARE_EVENT"),
      value: z.unknown(),
      idempotencyKey: z.string().trim().min(1).max(256),
      existingAttestationUid: Bytes32Schema.nullish(),
    })
    .strict(),
  z
    .object({
      schemaKind: z.literal("SHELTER_STATUS"),
      value: z.unknown(),
      idempotencyKey: z.string().trim().min(1).max(256),
      existingAttestationUid: Bytes32Schema.nullish(),
    })
    .strict(),
]);

export type EasAttestationInput = z.input<typeof AttestationInputSchema>;

export interface EasAttestationResult {
  readonly attestationUid: EasAttestationUid;
  readonly transactionHash: `0x${string}`;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly schemaUid: `0x${string}`;
  readonly issuer: Address;
  readonly verifiedAt: string;
}

export interface EasAttestationSubmission {
  readonly transactionHash: `0x${string}`;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly schemaUid: `0x${string}`;
  readonly issuer: Address;
}

export interface EasAttestationClient {
  /** Broadcasts once and returns the hash without waiting for a receipt. */
  submit(input: EasAttestationInput): Promise<EasAttestationSubmission>;
  /** Rechecks a previously persisted transaction without broadcasting again. */
  confirm(submission: EasAttestationSubmission): Promise<EasAttestationResult>;
  /** Convenience wrapper retained for isolated callers; durable workers use submit + confirm. */
  attest(input: EasAttestationInput): Promise<EasAttestationResult>;
}

const AttestationSubmissionSchema = z
  .object({
    transactionHash: TransactionHashSchema,
    chainId: z.literal(BASE_SEPOLIA_CHAIN_ID),
    schemaUid: Bytes32Schema,
    issuer: AddressSchema,
  })
  .strict();

function encodeAttestation(
  config: EasStartupConfig,
  input: z.output<typeof AttestationInputSchema>,
): { readonly schemaUid: `0x${string}`; readonly encodedData: Hex } {
  try {
    const isCareEvent = input.schemaKind === "CARE_EVENT";
    const fields = isCareEvent
      ? CareEventCodec.encode(input.value)
      : ShelterStatusCodec.encode(input.value);
    const schema = isCareEvent ? CARE_EVENT_SCHEMA : SHELTER_STATUS_SCHEMA;
    const schemaUid = isCareEvent ? config.careSchemaUid : config.shelterSchemaUid;
    const items: SchemaItem[] = fields.map((field) => ({
      name: field.name,
      type: field.type,
      value: field.value,
    }));
    const encodedData = new SchemaEncoder(schema).encodeData(items) as Hex;
    return Object.freeze({ schemaUid, encodedData });
  } catch {
    throw new EasClientError("INVALID_PAYLOAD", false);
  }
}

const normalizeReceipt = (input: unknown): EasAttestationReceipt => {
  const schema = z
    .object({
      status: z.enum(["success", "reverted"]),
      transactionHash: TransactionHashSchema,
      attestations: z.array(
        z.object({ uid: Bytes32Schema, schemaUid: Bytes32Schema, issuer: AddressSchema }).strict(),
      ),
    })
    .strict();
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new EasClientError("INVALID_RECEIPT", false);
  return parsed.data;
};

export const createEasAttestationClient = (input: {
  readonly config: EasStartupConfig;
  readonly port?: EasChainPort;
  readonly now?: () => Date;
}): EasAttestationClient => {
  const port = input.port ?? createViemEasChainPort(input.config);
  const now = input.now ?? (() => new Date());
  const submissionOperations = new Map<
    string,
    Readonly<{ fingerprint: string; promise: Promise<EasAttestationSubmission> }>
  >();
  const attestationOperations = new Map<
    string,
    Readonly<{ fingerprint: string; promise: Promise<EasAttestationResult> }>
  >();

  const performSubmission = async (
    encoded: ReturnType<typeof encodeAttestation>,
  ): Promise<EasAttestationSubmission> => {
    let chainId: number;
    try {
      chainId = await port.getChainId();
    } catch (error) {
      if (error instanceof EasClientError) throw error;
      throw new EasClientError("SUBMISSION_TEMPORARY", true);
    }
    if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
      throw new EasClientError("INVALID_CHAIN", false);
    }

    let transactionHash: `0x${string}`;
    try {
      transactionHash = TransactionHashSchema.parse(
        await port.submitAttestation({
          contractAddress: BASE_SEPOLIA_EAS_ADDRESS,
          schemaUid: encoded.schemaUid,
          encodedData: encoded.encodedData,
          revocable: true,
        }),
      );
    } catch (error) {
      if (error instanceof EasSubmissionUncertainError) {
        throw new EasClientError("CONFIRMATION_UNCERTAIN", false);
      }
      if (error instanceof EasClientError) throw error;
      throw new EasClientError("SUBMISSION_TEMPORARY", true);
    }

    return Object.freeze({
      transactionHash,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      schemaUid: encoded.schemaUid,
      issuer: input.config.issuer,
    });
  };

  const performConfirmation = async (
    submission: EasAttestationSubmission,
  ): Promise<EasAttestationResult> => {
    let receipt: EasAttestationReceipt;
    try {
      receipt = normalizeReceipt(await port.waitForAttestation(submission.transactionHash));
    } catch (error) {
      if (error instanceof EasClientError && error.code === "INVALID_RECEIPT") throw error;
      throw new EasClientError("CONFIRMATION_UNCERTAIN", false);
    }
    if (receipt.status !== "success") {
      throw new EasClientError("TRANSACTION_REVERTED", false);
    }
    if (
      receipt.transactionHash !== submission.transactionHash ||
      receipt.attestations.length !== 1
    ) {
      throw new EasClientError("INVALID_RECEIPT", false);
    }

    const attestation = receipt.attestations[0];
    if (
      !attestation ||
      attestation.schemaUid !== submission.schemaUid ||
      attestation.issuer !== submission.issuer
    ) {
      throw new EasClientError("INVALID_RECEIPT", false);
    }

    return Object.freeze({
      attestationUid: parseEasUid(attestation.uid),
      transactionHash: submission.transactionHash,
      chainId: submission.chainId,
      schemaUid: submission.schemaUid,
      issuer: submission.issuer,
      verifiedAt: now().toISOString(),
    });
  };

  const parseSubmissionRequest = (rawInput: EasAttestationInput) => {
    const parsed = AttestationInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new EasClientError("INVALID_PAYLOAD", false);
    if (parsed.data.existingAttestationUid) {
      throw new EasClientError("ALREADY_ATTESTED", false);
    }
    const encoded = encodeAttestation(input.config, parsed.data);
    return Object.freeze({
      request: parsed.data,
      encoded,
      fingerprint: `${encoded.schemaUid}:${encoded.encodedData}`,
    });
  };

  const submitOnce = (
    request: z.output<typeof AttestationInputSchema>,
    encoded: ReturnType<typeof encodeAttestation>,
    fingerprint: string,
  ): Promise<EasAttestationSubmission> => {
    const prior = submissionOperations.get(request.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new EasClientError("IDEMPOTENCY_CONFLICT", false);
      }
      return prior.promise;
    }

    const promise = performSubmission(encoded);
    submissionOperations.set(request.idempotencyKey, Object.freeze({ fingerprint, promise }));
    promise.catch((error: unknown) => {
      if (error instanceof EasClientError && error.retryable) {
        const current = submissionOperations.get(request.idempotencyKey);
        if (current?.promise === promise) submissionOperations.delete(request.idempotencyKey);
      }
    });
    return promise;
  };

  const client: EasAttestationClient = {
    async submit(rawInput: EasAttestationInput) {
      const { request, encoded, fingerprint } = parseSubmissionRequest(rawInput);
      return submitOnce(request, encoded, fingerprint);
    },

    async confirm(rawSubmission: EasAttestationSubmission) {
      const parsed = AttestationSubmissionSchema.safeParse(rawSubmission);
      if (
        !parsed.success ||
        parsed.data.issuer !== input.config.issuer ||
        (parsed.data.schemaUid !== input.config.careSchemaUid &&
          parsed.data.schemaUid !== input.config.shelterSchemaUid)
      ) {
        throw new EasClientError("INVALID_PAYLOAD", false);
      }
      return performConfirmation(parsed.data);
    },

    async attest(rawInput: EasAttestationInput) {
      const { request, encoded, fingerprint } = parseSubmissionRequest(rawInput);
      const prior = attestationOperations.get(request.idempotencyKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw new EasClientError("IDEMPOTENCY_CONFLICT", false);
        }
        return prior.promise;
      }

      const promise = submitOnce(request, encoded, fingerprint).then(performConfirmation);
      attestationOperations.set(request.idempotencyKey, Object.freeze({ fingerprint, promise }));
      promise.catch((error: unknown) => {
        if (error instanceof EasClientError && error.retryable) {
          const current = attestationOperations.get(request.idempotencyKey);
          if (current?.promise === promise) attestationOperations.delete(request.idempotencyKey);
        }
      });
      return promise;
    },
  };
  return Object.freeze(client);
};
