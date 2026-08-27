import "@tanstack/react-start/server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { getServerEnv, type ServerEnv } from "@/lib/env.server";

import { createEasAttestationClient, parseEasStartupConfig, type EasChainPort } from "./eas.server";
import {
  createSupabaseAttestationRepository,
  type AttestationDatabaseClient,
} from "./repository.server";
import { runAttestationWorker, type AttestationWorkerResult } from "./worker.server";

export const ATTESTATION_CRON_SECRET_MIN_LENGTH = 16;

export type AttestationRuntimeEnvironment = Pick<
  ServerEnv,
  | "BASE_SEPOLIA_RPC_URL"
  | "EAS_ATTESTER_PRIVATE_KEY"
  | "EAS_CARE_SCHEMA_UID"
  | "EAS_SHELTER_SCHEMA_UID"
  | "EAS_EXPECTED_ISSUER"
  | "SUBJECT_HASH_SECRET"
>;

export class AttestationRuntimeError extends Error {
  constructor(readonly code: "NOT_CONFIGURED") {
    super(code);
    this.name = "AttestationRuntimeError";
  }
}

export interface AttestationRuntime {
  run(): Promise<AttestationWorkerResult>;
}

/**
 * Compares fixed-size SHA-256 digests so both matching and mismatched token
 * lengths reach timingSafeEqual. The raw bearer and configured secret are not
 * returned, logged, or interpolated into errors.
 */
export function isAttestationCronAuthorized(
  authorizationHeader: string | null | undefined,
  cronSecret: string,
): boolean {
  const prefix = "Bearer ";
  const hasBearerFormat = authorizationHeader?.startsWith(prefix) === true;
  const provided = hasBearerFormat ? authorizationHeader.slice(prefix.length) : "";
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(cronSecret, "utf8").digest();
  const matches = timingSafeEqual(providedDigest, expectedDigest);
  return (
    cronSecret.length >= ATTESTATION_CRON_SECRET_MIN_LENGTH &&
    hasBearerFormat &&
    provided.length > 0 &&
    matches
  );
}

export function createAttestationRuntime(input: {
  readonly environment: AttestationRuntimeEnvironment;
  readonly databaseClient?: AttestationDatabaseClient;
  readonly easPort?: EasChainPort;
  readonly now?: () => Date;
  readonly limit?: number;
}): AttestationRuntime {
  try {
    const config = parseEasStartupConfig(input.environment as Record<string, unknown>);
    const subjectHashSecret = input.environment.SUBJECT_HASH_SECRET;
    if (!subjectHashSecret) throw new AttestationRuntimeError("NOT_CONFIGURED");

    const repository = input.databaseClient
      ? createSupabaseAttestationRepository({
          client: input.databaseClient,
          subjectHashSecret,
        })
      : createSupabaseAttestationRepository({ subjectHashSecret });
    const eas = input.easPort
      ? createEasAttestationClient({ config, port: input.easPort })
      : createEasAttestationClient({ config });
    const now = input.now ?? (() => new Date());
    const limit = input.limit ?? 20;

    return Object.freeze({
      run: () => runAttestationWorker({ repository, eas, now, limit }),
    });
  } catch {
    throw new AttestationRuntimeError("NOT_CONFIGURED");
  }
}

export function createProductionAttestationRuntime(input?: {
  readonly now?: () => Date;
  readonly limit?: number;
}): AttestationRuntime {
  const environment = getServerEnv();
  const base = { environment };
  if (input?.now && input.limit !== undefined) {
    return createAttestationRuntime({ ...base, now: input.now, limit: input.limit });
  }
  if (input?.now) return createAttestationRuntime({ ...base, now: input.now });
  if (input?.limit !== undefined) return createAttestationRuntime({ ...base, limit: input.limit });
  return createAttestationRuntime(base);
}
