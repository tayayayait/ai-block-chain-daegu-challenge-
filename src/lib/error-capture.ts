export type SafeErrorService = "framework" | "request-middleware" | "ssr";

export interface SafeServerErrorLog {
  readonly event: "server_error";
  readonly code: "INTERNAL_ERROR";
  readonly service: SafeErrorService;
  readonly status: number;
}

type SafeErrorSink = (entry: SafeServerErrorLog) => void;

let lastCapturedError: { entry: SafeServerErrorLog; at: number } | undefined;
const TTL_MS = 5_000;
const SAFE_SERVICES: readonly SafeErrorService[] = ["framework", "request-middleware", "ssr"];
const SAFE_LOG_KEYS = ["code", "event", "service", "status"] as const;

const safeStatus = (status: number): number =>
  Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;

const safeService = (service: SafeErrorService): SafeErrorService =>
  SAFE_SERVICES.includes(service) ? service : "framework";

export function createSafeServerErrorLog(
  service: SafeErrorService = "framework",
  status = 500,
): SafeServerErrorLog {
  return Object.freeze({
    event: "server_error",
    code: "INTERNAL_ERROR",
    service: safeService(service),
    status: safeStatus(status),
  });
}

// Compatibility helper for callers that only need a stable diagnostic code.
// The raw value is deliberately never inspected or serialized.
export function describeError(_error: unknown): string {
  return "INTERNAL_ERROR";
}

function isSafeServerErrorLog(value: unknown): value is SafeServerErrorLog {
  try {
    if (value === null || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();

    return (
      keys.length === SAFE_LOG_KEYS.length &&
      keys.every((key, index) => key === SAFE_LOG_KEYS[index]) &&
      record["event"] === "server_error" &&
      record["code"] === "INTERNAL_ERROR" &&
      typeof record["service"] === "string" &&
      SAFE_SERVICES.includes(record["service"] as SafeErrorService) &&
      typeof record["status"] === "number" &&
      safeStatus(record["status"]) === record["status"]
    );
  } catch {
    return false;
  }
}

function safeLogFromConsoleArgs(args: readonly unknown[]): SafeServerErrorLog {
  if (args.length === 1 && isSafeServerErrorLog(args[0])) {
    return createSafeServerErrorLog(args[0].service, args[0].status);
  }
  return createSafeServerErrorLog();
}

function record(entry: SafeServerErrorLog) {
  lastCapturedError = { entry, at: Date.now() };
}

/**
 * Replaces console.error at the server boundary so framework and dependency
 * errors cannot serialize raw messages, stacks, causes, responses, or objects.
 * The returned cleanup restores the exact previous console implementation.
 */
export function installSafeConsoleError(sink?: SafeErrorSink): () => void {
  const previousConsoleError = console.error;
  const output: SafeErrorSink = sink ?? ((entry) => previousConsoleError.call(console, entry));
  const safeConsoleError = (...args: unknown[]) => {
    const entry = safeLogFromConsoleArgs(args);
    record(entry);
    output(entry);
  };

  console.error = safeConsoleError;

  return () => {
    if (console.error === safeConsoleError) {
      console.error = previousConsoleError;
    }
  };
}

export function reportSafeServerError(service: SafeErrorService, status = 500): void {
  console.error(createSafeServerErrorLog(service, status));
}

export function consumeLastCapturedError(): SafeServerErrorLog | undefined {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { entry } = lastCapturedError;
  lastCapturedError = undefined;
  return entry;
}
