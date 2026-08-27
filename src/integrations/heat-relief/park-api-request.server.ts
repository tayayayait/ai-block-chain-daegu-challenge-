import "@tanstack/react-start/server-only";

import { DaeguParkFacilityError } from "./park-facility.server.ts";

type Sleep = (milliseconds: number) => Promise<void>;

const defaultSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isRetryableParkApiError(error: unknown): boolean {
  if (!(error instanceof DaeguParkFacilityError)) return false;
  if (error.code === "TIMEOUT" || error.code === "NETWORK_ERROR") return true;
  return (
    error.code === "HTTP_ERROR" &&
    (error.status === 429 || (error.status !== null && error.status >= 500))
  );
}

export async function retryParkApiRequest<T>(
  request: () => Promise<T>,
  options: {
    readonly maxAttempts?: number;
    readonly baseDelayMs?: number;
    readonly sleep?: Sleep;
  } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 750;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (!isRetryableParkApiError(error) || attempt + 1 >= maxAttempts) throw error;
      await sleep(Math.min(baseDelayMs * 2 ** attempt, 8_000));
    }
  }

  throw lastError;
}

export function createParkApiRequestQueue(
  options: {
    readonly minimumIntervalMs?: number;
    readonly maxAttempts?: number;
    readonly baseDelayMs?: number;
    readonly sleep?: Sleep;
    readonly now?: () => number;
  } = {},
) {
  const minimumIntervalMs = options.minimumIntervalMs ?? 300;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  let nextStartAt = 0;
  let tail: Promise<void> = Promise.resolve();

  return function enqueue<T>(request: () => Promise<T>): Promise<T> {
    const run = tail.then(() =>
      retryParkApiRequest(
        async () => {
          const currentTime = now();
          const waitMs = Math.max(0, nextStartAt - currentTime);
          if (waitMs > 0) await sleep(waitMs);
          nextStartAt = Math.max(now(), nextStartAt) + minimumIntervalMs;
          return request();
        },
        {
          ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
          ...(options.baseDelayMs === undefined ? {} : { baseDelayMs: options.baseDelayMs }),
          sleep,
        },
      ),
    );
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
