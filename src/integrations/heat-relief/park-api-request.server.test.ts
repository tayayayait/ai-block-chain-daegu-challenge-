import { describe, expect, it, vi } from "vitest";

import { DaeguParkFacilityError } from "./park-facility.server";
import {
  createParkApiRequestQueue,
  isRetryableParkApiError,
  retryParkApiRequest,
} from "./park-api-request.server";

describe("Daegu park API request policy", () => {
  it("retries HTTP 429 with bounded exponential backoff", async () => {
    const request = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new DaeguParkFacilityError("HTTP_ERROR", 429))
      .mockRejectedValueOnce(new DaeguParkFacilityError("HTTP_ERROR", 429))
      .mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      retryParkApiRequest(request, { maxAttempts: 4, baseDelayMs: 500, sleep }),
    ).resolves.toBe("ok");
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[500], [1_000]]);
  });

  it("does not retry authentication or provider-contract failures", async () => {
    const error = new DaeguParkFacilityError("HTTP_ERROR", 401);
    const request = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(retryParkApiRequest(request, { sleep })).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(isRetryableParkApiError(new DaeguParkFacilityError("TIMEOUT"))).toBe(true);
  });

  it("serializes concurrent work and spaces request starts", async () => {
    let clock = 0;
    const waits: number[] = [];
    const starts: number[] = [];
    const queue = createParkApiRequestQueue({
      minimumIntervalMs: 300,
      now: () => clock,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        clock += milliseconds;
      },
    });

    await Promise.all(
      [0, 1, 2].map(() =>
        queue(async () => {
          starts.push(clock);
          return "ok";
        }),
      ),
    );

    expect(starts).toEqual([0, 300, 600]);
    expect(waits).toEqual([300, 300]);
  });
});
