import { describe, expect, it, vi } from "vitest";

import type { RetentionRepository } from "./repository.server";
import { runRetentionWorker } from "./worker.server";

const NOW = new Date("2026-08-24T08:00:00.000Z");
const CLEANUP = {
  access_tokens: 1,
  access_sessions: 0,
  route_cache: 0,
  medication_api_cache: 2,
  guardian_alerts: 0,
  attestation_jobs: 0,
  risk_recompute_queue: 1,
};

function claim(index: number) {
  const suffix = index.toString().padStart(12, "0");
  return {
    cleanupJobId: `10000000-0000-4000-8000-${suffix}`,
    imagePath: `path-${index}`,
    leaseToken: `20000000-0000-4000-8000-${suffix}`,
    attemptCount: index,
  };
}

function repository(overrides: Partial<RetentionRepository> = {}): RetentionRepository {
  return {
    cleanupDatabase: vi.fn(async () => CLEANUP),
    claimImageCleanupJobs: vi.fn(async () => []),
    deleteImageObject: vi.fn(async () => true),
    finalizeImageCleanup: vi.fn(async () => "APPLIED" as const),
    ...overrides,
  };
}

describe("retention worker", () => {
  it("scrubs metadata only after Storage confirms deletion and schedules safe retries", async () => {
    const claims = [
      {
        cleanupJobId: "10000000-0000-4000-8000-000000000001",
        imagePath: "path-1",
        leaseToken: "20000000-0000-4000-8000-000000000001",
        attemptCount: 1,
      },
      {
        cleanupJobId: "10000000-0000-4000-8000-000000000002",
        imagePath: "path-2",
        leaseToken: "20000000-0000-4000-8000-000000000002",
        attemptCount: 2,
      },
    ];
    const deleteImageObject = vi
      .fn<RetentionRepository["deleteImageObject"]>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const finalizeImageCleanup = vi.fn<RetentionRepository["finalizeImageCleanup"]>(async () =>
      Promise.resolve("APPLIED"),
    );

    const result = await runRetentionWorker({
      repository: repository({
        claimImageCleanupJobs: vi.fn(async () => claims),
        deleteImageObject,
        finalizeImageCleanup,
      }),
      now: () => NOW,
    });

    expect(result).toMatchObject({
      kind: "COMPLETED",
      imageClaimed: 2,
      imageDeleted: 1,
      imageRetryScheduled: 1,
    });
    const firstClaim = claims[0];
    if (!firstClaim) throw new Error("expected first cleanup claim");
    expect(finalizeImageCleanup).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cleanupJobId: firstClaim.cleanupJobId,
        leaseToken: firstClaim.leaseToken,
        deleted: true,
        errorCode: null,
      }),
    );
    expect(finalizeImageCleanup).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ deleted: false, errorCode: "STORAGE_DELETE_FAILED" }),
    );
  });

  it("does not attempt Storage work when the bounded database cleanup fails", async () => {
    const deleteImageObject = vi.fn();
    const result = await runRetentionWorker({
      repository: repository({
        cleanupDatabase: vi.fn(async () => {
          throw new Error("PRIVATE_DATABASE_DIAGNOSTIC");
        }),
        deleteImageObject,
      }),
      now: () => NOW,
    });

    expect(result).toEqual({
      kind: "TEMPORARY_FAILURE",
      code: "RETENTION_DATABASE_UNAVAILABLE",
    });
    expect(deleteImageObject).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DATABASE_DIAGNOSTIC");
  });

  it("uses a fresh validated timestamp for cleanup, claim, and finalize", async () => {
    const cleanupDatabase = vi.fn<RetentionRepository["cleanupDatabase"]>(async () => CLEANUP);
    const claimImageCleanupJobs = vi.fn<RetentionRepository["claimImageCleanupJobs"]>(async () => [
      claim(1),
    ]);
    const finalizeImageCleanup = vi.fn<RetentionRepository["finalizeImageCleanup"]>(async () =>
      Promise.resolve("APPLIED"),
    );
    const times = [
      new Date("2026-08-24T08:00:00.000Z"),
      new Date("2026-08-24T08:00:01.000Z"),
      new Date("2026-08-24T08:00:02.000Z"),
    ];
    const now = vi.fn(() => {
      const value = times.shift();
      if (!value) throw new Error("unexpected clock read");
      return value;
    });

    const result = await runRetentionWorker({
      repository: repository({ cleanupDatabase, claimImageCleanupJobs, finalizeImageCleanup }),
      now,
    });

    expect(result.kind).toBe("COMPLETED");
    expect(cleanupDatabase).toHaveBeenCalledWith({
      now: "2026-08-24T08:00:00.000Z",
      limit: 500,
    });
    expect(claimImageCleanupJobs).toHaveBeenCalledWith({
      now: "2026-08-24T08:00:01.000Z",
      limit: 50,
    });
    expect(finalizeImageCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ now: "2026-08-24T08:00:02.000Z" }),
    );
    expect(now).toHaveBeenCalledTimes(3);
  });

  it("converts a thrown Storage deletion into a retryable finalization", async () => {
    const finalizeImageCleanup = vi.fn<RetentionRepository["finalizeImageCleanup"]>(async () =>
      Promise.resolve("APPLIED"),
    );

    const result = await runRetentionWorker({
      repository: repository({
        claimImageCleanupJobs: vi.fn(async () => [claim(1)]),
        deleteImageObject: vi.fn(async () => {
          throw new Error("PRIVATE_STORAGE_DIAGNOSTIC");
        }),
        finalizeImageCleanup,
      }),
      now: () => NOW,
    });

    expect(result).toMatchObject({
      kind: "COMPLETED",
      imageDeleted: 0,
      imageRetryScheduled: 1,
      imageFinalizeFailed: 0,
    });
    expect(finalizeImageCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ deleted: false, errorCode: "STORAGE_DELETE_FAILED" }),
    );
    expect(JSON.stringify(result)).not.toContain("PRIVATE_STORAGE_DIAGNOSTIC");
  });

  it("bounds a stalled Storage deletion and schedules a retry", async () => {
    vi.useFakeTimers();
    try {
      const finalizeImageCleanup = vi.fn<RetentionRepository["finalizeImageCleanup"]>(async () =>
        Promise.resolve("APPLIED"),
      );
      const resultPromise = runRetentionWorker({
        repository: repository({
          claimImageCleanupJobs: vi.fn(async () => [claim(1)]),
          deleteImageObject: vi.fn(() => new Promise<boolean>(() => undefined)),
          finalizeImageCleanup,
        }),
        now: () => NOW,
        imageDeleteTimeoutMs: 25,
      });

      await vi.advanceTimersByTimeAsync(25);
      const result = await resultPromise;

      expect(result).toMatchObject({
        kind: "COMPLETED",
        imageDeleted: 0,
        imageRetryScheduled: 1,
      });
      expect(finalizeImageCleanup).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: false, errorCode: "STORAGE_DELETE_FAILED" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a finalize failure after deletion without counting the image as deleted", async () => {
    const result = await runRetentionWorker({
      repository: repository({
        claimImageCleanupJobs: vi.fn(async () => [claim(1)]),
        deleteImageObject: vi.fn(async () => true),
        finalizeImageCleanup: vi.fn(async () => {
          throw new Error("DATABASE_UNAVAILABLE_AFTER_DELETE");
        }),
      }),
      now: () => NOW,
    });

    expect(result).toMatchObject({
      kind: "COMPLETED",
      imageDeleted: 0,
      imageRetryScheduled: 0,
      imageFinalizeFailed: 1,
    });
  });

  it("counts LEASE_LOST without treating deletion as applied", async () => {
    const result = await runRetentionWorker({
      repository: repository({
        claimImageCleanupJobs: vi.fn(async () => [claim(1)]),
        deleteImageObject: vi.fn(async () => true),
        finalizeImageCleanup: vi.fn(async () => "LEASE_LOST" as const),
      }),
      now: () => NOW,
    });

    expect(result).toMatchObject({
      kind: "COMPLETED",
      imageDeleted: 0,
      imageLeaseLost: 1,
      imageFinalizeFailed: 0,
    });
  });

  it("processes claims concurrently while never exceeding four active deletions", async () => {
    vi.useFakeTimers();
    try {
      let active = 0;
      let maximumActive = 0;
      const deleteImageObject = vi.fn(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return true;
      });
      const resultPromise = runRetentionWorker({
        repository: repository({
          claimImageCleanupJobs: vi.fn(async () =>
            Array.from({ length: 10 }, (_, i) => claim(i + 1)),
          ),
          deleteImageObject,
        }),
        now: () => NOW,
        imageConcurrency: 4,
        imageDeleteTimeoutMs: 100,
      });

      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(result).toMatchObject({ kind: "COMPLETED", imageClaimed: 10, imageDeleted: 10 });
      expect(maximumActive).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
