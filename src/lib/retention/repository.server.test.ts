import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseRetentionRepository,
  RetentionRepositoryError,
  type RetentionClient,
} from "./repository.server";

const SESSION_ID = "10000000-0000-4000-8000-000000000001";
const SUBJECT_ID = "20000000-0000-4000-8000-000000000001";
const CLEANUP_JOB_ID = "30000000-0000-4000-8000-000000000001";
const LEASE_TOKEN = "40000000-0000-4000-8000-000000000001";
const IMAGE_PATH = `${SUBJECT_ID}/${SESSION_ID}-attempt-1.jpg`;
const NOW = "2026-08-24T08:00:00.000Z";
type RemoveImageObjects = ReturnType<RetentionClient["storage"]["from"]>["remove"];

function client(input: {
  rpc: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
}): RetentionClient {
  return {
    rpc: input.rpc as unknown as RetentionClient["rpc"],
    storage: {
      from: vi.fn(() => ({
        remove: (input.remove ??
          vi.fn(async () => ({ data: [], error: null }))) as unknown as RemoveImageObjects,
      })),
    },
  };
}

describe("Supabase retention repository", () => {
  it("parses bounded cleanup and image claims without returning raw database objects", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "run_retention_cleanup") {
        return {
          data: {
            access_tokens: 1,
            access_sessions: 2,
            route_cache: 3,
            medication_api_cache: 4,
            guardian_alerts: 5,
            attestation_jobs: 6,
            risk_recompute_queue: 7,
          },
          error: null,
        };
      }
      return {
        data: [
          {
            cleanup_job_id: CLEANUP_JOB_ID,
            image_path: IMAGE_PATH,
            lease_token: LEASE_TOKEN,
            attempt_count: 1,
          },
        ],
        error: null,
      };
    });
    const repository = createSupabaseRetentionRepository(client({ rpc }));

    await expect(repository.cleanupDatabase({ now: NOW, limit: 500 })).resolves.toMatchObject({
      medication_api_cache: 4,
      risk_recompute_queue: 7,
    });
    await expect(repository.claimImageCleanupJobs({ now: NOW, limit: 50 })).resolves.toEqual([
      {
        cleanupJobId: CLEANUP_JOB_ID,
        imagePath: IMAGE_PATH,
        leaseToken: LEASE_TOKEN,
        attemptCount: 1,
      },
    ]);
  });

  it("requires confirmed Storage deletion before a successful finalize", async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const rpc = vi.fn(async () => ({ data: "APPLIED", error: null }));
    const repository = createSupabaseRetentionRepository(client({ rpc, remove }));

    await expect(repository.deleteImageObject(IMAGE_PATH)).resolves.toBe(true);
    await expect(
      repository.finalizeImageCleanup({
        cleanupJobId: CLEANUP_JOB_ID,
        leaseToken: LEASE_TOKEN,
        deleted: true,
        errorCode: null,
        now: NOW,
      }),
    ).resolves.toBe("APPLIED");
    expect(remove).toHaveBeenCalledWith([IMAGE_PATH]);
    expect(rpc).toHaveBeenCalledWith(
      "finalize_medication_image_cleanup",
      expect.objectContaining({
        p_cleanup_job_id: CLEANUP_JOB_ID,
        p_lease_token: LEASE_TOKEN,
        p_deleted: true,
        p_error_code: null,
      }),
    );
  });

  it("treats a Storage remove response error as a retryable fixed outcome", async () => {
    const remove = vi.fn(async () => ({ data: null, error: { message: `raw:${IMAGE_PATH}` } }));
    const repository = createSupabaseRetentionRepository(
      client({ rpc: vi.fn(async () => ({ data: null, error: null })), remove }),
    );

    await expect(repository.deleteImageObject(IMAGE_PATH)).resolves.toBe(false);
  });

  it("treats a thrown Storage remove failure as a retryable fixed outcome", async () => {
    const remove = vi.fn(async () => {
      throw new Error(`provider:${IMAGE_PATH}`);
    });
    const repository = createSupabaseRetentionRepository(
      client({ rpc: vi.fn(async () => ({ data: null, error: null })), remove }),
    );

    await expect(repository.deleteImageObject(IMAGE_PATH)).resolves.toBe(false);
  });

  it("fails closed on malformed paths and malformed RPC responses", async () => {
    const remove = vi.fn();
    const repository = createSupabaseRetentionRepository(
      client({ rpc: vi.fn(async () => ({ data: { unexpected: true }, error: null })), remove }),
    );

    await expect(repository.deleteImageObject("../private-key")).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
    await expect(repository.cleanupDatabase({ now: NOW, limit: 1 })).rejects.toBeInstanceOf(
      RetentionRepositoryError,
    );
  });
});
