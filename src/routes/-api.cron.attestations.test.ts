import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AttestationWorkerResult } from "@/lib/attestation/worker.server";
import {
  handleAttestationCronRequest,
  type AttestationCronHandlerDependencies,
} from "./api.cron.attestations";

const SECRET = "attestation-route-cron-secret-123456";
const NOW = new Date("2026-08-24T00:00:00.000Z");

function completed(
  overrides: Partial<Extract<AttestationWorkerResult, { kind: "COMPLETED" }>> = {},
): Extract<AttestationWorkerResult, { kind: "COMPLETED" }> {
  return {
    kind: "COMPLETED",
    claimed: 3,
    verified: 1,
    retryScheduled: 1,
    failed: 1,
    leaseLost: 0,
    finalizeFailed: 0,
    ...overrides,
  };
}

function dependencies(
  runWorker: AttestationCronHandlerDependencies["runWorker"],
  cronSecret: string | null = SECRET,
): AttestationCronHandlerDependencies {
  return {
    getCronSecret: () => cronSecret ?? undefined,
    now: () => NOW,
    runWorker,
  };
}

function request(authorization?: string): Request {
  return new Request(
    "https://onjung.example/api/cron/attestations",
    authorization ? { headers: { authorization } } : {},
  );
}

describe("GET /api/cron/attestations", () => {
  it("authenticates before constructing or running the EAS runtime", async () => {
    const runWorker = vi.fn(async () => completed());

    for (const authorization of [undefined, "Bearer wrong", `Bearer ${SECRET}extra`]) {
      const response = await handleAttestationCronRequest(
        request(authorization),
        dependencies(runWorker),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
    }
    expect(runWorker).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is absent or below the minimum length", async () => {
    const runWorker = vi.fn(async () => completed());

    for (const cronSecret of [null, "too-short"]) {
      const response = await handleAttestationCronRequest(
        request(`Bearer ${SECRET}`),
        dependencies(runWorker, cronSecret),
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        code: "CRON_NOT_CONFIGURED",
      });
    }
    expect(runWorker).not.toHaveBeenCalled();
  });

  it("returns only safe worker counts and no chain, job, RPC, or secret metadata", async () => {
    const runWorker = vi.fn(async () => completed());
    const response = await handleAttestationCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(runWorker),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(text)).toEqual({
      ok: true,
      summary: {
        claimed: 3,
        verified: 1,
        retryScheduled: 1,
        failed: 1,
        leaseLost: 0,
        finalizeFailed: 0,
      },
    });
    expect(runWorker).toHaveBeenCalledWith(NOW);
    expect(text).not.toMatch(/0x|uid|issuer|schema|rpc|private|secret|jobId/iu);
  });

  it("maps an unavailable outbox to a stable retryable service response", async () => {
    const response = await handleAttestationCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(async () => ({ kind: "TEMPORARY_FAILURE", code: "OUTBOX_UNAVAILABLE" })),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "ATTESTATION_OUTBOX_UNAVAILABLE",
    });
  });

  it("rejects malformed count summaries instead of serializing untrusted runtime output", async () => {
    const response = await handleAttestationCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(async () => ({ ...completed(), claimed: -1 }) as never),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "ATTESTATION_WORKER_FAILED",
    });
  });

  it("returns a distinct safe 503 when EAS runtime environment is not configured", async () => {
    const response = await handleAttestationCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(async () => {
        const { AttestationRuntimeError } = await import("@/lib/attestation/runtime.server");
        throw new AttestationRuntimeError("NOT_CONFIGURED");
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "ATTESTATION_NOT_CONFIGURED",
    });
  });

  it("discards unexpected provider and database error details", async () => {
    const leaked = "rpc=https://secret.example privateKey=0xdead phone=010-1234-5678";
    const response = await handleAttestationCronRequest(
      request(`Bearer ${SECRET}`),
      dependencies(async () => Promise.reject(new Error(leaked))),
    );
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ ok: false, code: "ATTESTATION_WORKER_FAILED" });
    expect(text).not.toContain(leaked);
    expect(text).not.toMatch(/secret\.example|010-|0xdead/iu);
  });
});

describe("attestation cron route contract", () => {
  it("remains server-only and composes the production runtime only after authorization", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/routes/api.cron.attestations.ts"),
      "utf8",
    );

    expect(source).toContain('import "@tanstack/react-start/server-only"');
    expect(source).toContain('createFileRoute("/api/cron/attestations")');
    expect(source).toContain("createProductionAttestationRuntime");
    expect(source).toContain("isAttestationCronAuthorized");
    expect(source).not.toMatch(
      /console\.(?:log|error)|EAS_ATTESTER_PRIVATE_KEY|BASE_SEPOLIA_RPC_URL|SUPABASE_SECRET_KEY/iu,
    );
  });
});
