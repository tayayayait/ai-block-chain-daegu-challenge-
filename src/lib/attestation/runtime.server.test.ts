import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

import type { AttestationDatabaseClient } from "./repository.server";
import { REQUIRED_EAS_SCHEMA_UIDS } from "./schema-uids.server";
import {
  ATTESTATION_CRON_SECRET_MIN_LENGTH,
  AttestationRuntimeError,
  createAttestationRuntime,
  isAttestationCronAuthorized,
} from "./runtime.server";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as const;
const ISSUER = privateKeyToAccount(PRIVATE_KEY).address;
const SECRET = "attestation-cron-secret-123456";

const environment = {
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.example",
  EAS_ATTESTER_PRIVATE_KEY: PRIVATE_KEY,
  EAS_CARE_SCHEMA_UID: REQUIRED_EAS_SCHEMA_UIDS.careEvent,
  EAS_SHELTER_SCHEMA_UID: REQUIRED_EAS_SCHEMA_UIDS.shelterStatus,
  EAS_EXPECTED_ISSUER: ISSUER,
  // secret-scan: allow-next-line -- test-fixture
  SUBJECT_HASH_SECRET: "s".repeat(32),
};

describe("attestation server runtime", () => {
  it("composes the durable repository and worker without touching the chain when no jobs are due", async () => {
    const calls: unknown[] = [];
    const databaseClient: AttestationDatabaseClient = {
      from: () => {
        throw new Error("no target query expected");
      },
      rpc: async (name, parameters) => {
        calls.push({ name, parameters });
        return { data: [], error: null };
      },
    };
    const getChainId = vi.fn(async () => 84532);
    const runtime = createAttestationRuntime({
      environment,
      databaseClient,
      easPort: {
        getChainId,
        submitAttestation: async () => `0x${"c".repeat(64)}`,
        waitForAttestation: async () => {
          throw new Error("not expected");
        },
      },
      now: () => new Date("2026-08-24T00:00:00.000Z"),
      limit: 10,
    });

    await expect(runtime.run()).resolves.toEqual({
      kind: "COMPLETED",
      claimed: 0,
      verified: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0,
      finalizeFailed: 0,
    });
    expect(calls).toEqual([
      {
        name: "claim_attestation_jobs",
        parameters: {
          p_now: "2026-08-24T00:00:00.000Z",
          p_lease_until: "2026-08-24T00:04:00.000Z",
          p_limit: 10,
        },
      },
    ]);
    expect(getChainId).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...environment, BASE_SEPOLIA_RPC_URL: undefined }],
    [{ ...environment, SUBJECT_HASH_SECRET: undefined }],
    // secret-scan: allow-next-line -- test-fixture
    [{ ...environment, SUBJECT_HASH_SECRET: "too-short" }],
    [{ ...environment, EAS_EXPECTED_ISSUER: `0x${"12".repeat(20)}` }],
  ])(
    "fails closed with a stable error when EAS runtime configuration is incomplete",
    (candidate) => {
      let error: unknown;
      try {
        createAttestationRuntime({ environment: candidate });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(AttestationRuntimeError);
      expect(error).toMatchObject({ code: "NOT_CONFIGURED", message: "NOT_CONFIGURED" });
      expect(JSON.stringify(error)).not.toContain(PRIVATE_KEY);
    },
  );
});

describe("attestation cron authorization", () => {
  it("accepts only the exact bearer token and rejects malformed or differently sized values", () => {
    expect(ATTESTATION_CRON_SECRET_MIN_LENGTH).toBeGreaterThanOrEqual(16);
    expect(isAttestationCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAttestationCronAuthorized(undefined, SECRET)).toBe(false);
    expect(isAttestationCronAuthorized("Basic opaque", SECRET)).toBe(false);
    expect(isAttestationCronAuthorized("Bearer wrong", SECRET)).toBe(false);
    expect(isAttestationCronAuthorized(`Bearer ${SECRET}extra`, SECRET)).toBe(false);
    expect(isAttestationCronAuthorized(`Bearer ${SECRET}`, "short")).toBe(false);
  });

  it("uses fixed-size digests with timingSafeEqual rather than direct secret equality", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/attestation/runtime.server.ts"),
      "utf8",
    );

    expect(source).toContain("timingSafeEqual");
    expect(source).toContain('createHash("sha256")');
    expect(source).not.toMatch(/provided\s*===\s*(?:cronSecret|expected)/u);
  });
});
