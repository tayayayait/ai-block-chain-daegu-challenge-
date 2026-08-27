import "@tanstack/react-start/server-only";

import { z } from "zod";

import { DemoNotificationError } from "./demo-provider.server";
import type { NotificationProvider } from "./provider";
import type {
  ClaimedGuardianAlert,
  NotificationFinalizeOutcome,
  NotificationRepository,
} from "./repository.server";

// A single item is claimed per lease. The longer bounded lease covers a
// provider timeout while the owner token prevents a stale worker from
// finalizing a later claim.
const LEASE_MS = 4 * 60_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_SECONDS = 15 * 60;
const SafeErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u);
const TimestampSchema = z.string().datetime({ offset: true });

const ProviderResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("demo-recorded"),
      providerMessageId: z.string().regex(/^demo_[0-9a-f]{64}$/u),
      recordedAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("accepted"),
      providerMessageId: z.string().trim().min(1).max(256),
      acceptedAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("retryable-failure"),
      code: z.string(),
      retryAfterSeconds: z.number().int().positive().max(MAX_RETRY_AFTER_SECONDS).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("permanent-failure"), code: z.string() }).strict(),
]);

export interface NotificationDeepLinkIssuer {
  issue(input: {
    readonly alertId: string;
    readonly eventId: string;
    readonly claimToken: string;
    readonly expectedLeaseUntil: string;
  }): Promise<string>;
}

export type DemoNotificationWorkerResult =
  | Readonly<{
      kind: "COMPLETED";
      claimed: number;
      demoRecorded: number;
      suppressed: number;
      retryScheduled: number;
      failedPermanent: number;
      leaseLost: number;
    }>
  | Readonly<{ kind: "TEMPORARY_FAILURE"; code: "OUTBOX_UNAVAILABLE" }>;

interface WorkerCounters {
  claimed: number;
  demoRecorded: number;
  suppressed: number;
  retryScheduled: number;
  failedPermanent: number;
  leaseLost: number;
}

const safeErrorCode = (value: string, fallback: string): string => {
  const parsed = SafeErrorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
};

const randomUnit = (random: () => number): number => {
  const value = random();
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
};

const retryDelayMs = (
  attemptCount: number,
  retryAfterSeconds: number | undefined,
  random: () => number,
): number => {
  const base = 2_000 * 4 ** Math.max(0, attemptCount - 1);
  const jittered = Math.floor(base * (1 + randomUnit(random) * 0.25));
  const providerDelay = (retryAfterSeconds ?? 0) * 1_000;
  return Math.max(jittered, providerDelay);
};

const retryOrExhausted = (input: {
  item: ClaimedGuardianAlert;
  now: Date;
  random: () => number;
  errorCode: string;
  retryAfterSeconds?: number;
}): NotificationFinalizeOutcome => {
  if (input.item.attemptCount >= MAX_ATTEMPTS) {
    return { kind: "FAILED_PERMANENT", errorCode: "RETRY_EXHAUSTED" };
  }
  const delayMs = retryDelayMs(input.item.attemptCount, input.retryAfterSeconds, input.random);
  return {
    kind: "RETRY_WAIT",
    errorCode: input.errorCode,
    nextAttemptAt: new Date(input.now.getTime() + delayMs).toISOString(),
  };
};

const providerOutcome = (input: {
  item: ClaimedGuardianAlert;
  result: unknown;
  now: Date;
  random: () => number;
}): NotificationFinalizeOutcome => {
  const parsed = ProviderResultSchema.safeParse(input.result);
  if (!parsed.success) {
    return retryOrExhausted({
      item: input.item,
      now: input.now,
      random: input.random,
      errorCode: "PROVIDER_INVALID_RESPONSE",
    });
  }
  const result = parsed.data;
  switch (result.kind) {
    case "demo-recorded":
      return {
        kind: "DEMO_RECORDED",
        providerMessageId: result.providerMessageId,
        recordedAt: result.recordedAt,
      };
    case "accepted":
      return { kind: "FAILED_PERMANENT", errorCode: "LIVE_RESULT_IN_DEMO_MODE" };
    case "retryable-failure": {
      const request: Parameters<typeof retryOrExhausted>[0] = {
        item: input.item,
        now: input.now,
        random: input.random,
        errorCode: safeErrorCode(result.code, "PROVIDER_RETRYABLE"),
      };
      if (result.retryAfterSeconds !== undefined) {
        request.retryAfterSeconds = result.retryAfterSeconds;
      }
      return retryOrExhausted(request);
    }
    case "permanent-failure":
      return {
        kind: "FAILED_PERMANENT",
        errorCode: safeErrorCode(result.code, "PROVIDER_PERMANENT"),
      };
  }
};

const thrownOutcome = (input: {
  item: ClaimedGuardianAlert;
  error: unknown;
  now: Date;
  random: () => number;
}): NotificationFinalizeOutcome => {
  if (input.error instanceof DemoNotificationError) {
    return { kind: "FAILED_PERMANENT", errorCode: input.error.code };
  }
  return retryOrExhausted({
    item: input.item,
    now: input.now,
    random: input.random,
    errorCode: "PROVIDER_TEMPORARY",
  });
};

const countApplied = (
  counters: WorkerCounters,
  outcome: NotificationFinalizeOutcome,
  disposition: "APPLIED" | "IDEMPOTENT" | "LEASE_LOST",
): void => {
  if (disposition === "LEASE_LOST") {
    counters.leaseLost += 1;
    return;
  }
  switch (outcome.kind) {
    case "DEMO_RECORDED":
      counters.demoRecorded += 1;
      return;
    case "SUPPRESSED":
      counters.suppressed += 1;
      return;
    case "RETRY_WAIT":
      counters.retryScheduled += 1;
      return;
    case "FAILED_PERMANENT":
      counters.failedPermanent += 1;
      return;
  }
};

const finalizeSafely = async (
  repository: NotificationRepository,
  item: ClaimedGuardianAlert,
  outcome: NotificationFinalizeOutcome,
  counters: WorkerCounters,
): Promise<void> => {
  try {
    const result = await repository.finalize({
      alertId: item.alertId,
      claimToken: item.claimToken,
      expectedLeaseUntil: item.leaseUntil,
      outcome,
    });
    countApplied(counters, outcome, result.disposition);
  } catch {
    counters.leaseLost += 1;
  }
};

const processItem = async (input: {
  repository: NotificationRepository;
  provider: NotificationProvider;
  deepLinkIssuer: NotificationDeepLinkIssuer;
  item: ClaimedGuardianAlert;
  now: Date;
  clock: () => Date;
  random: () => number;
  counters: WorkerCounters;
}): Promise<void> => {
  let eligibility;
  try {
    eligibility = await input.repository.recheckEligibility({
      alertId: input.item.alertId,
      claimToken: input.item.claimToken,
      expectedLeaseUntil: input.item.leaseUntil,
      expectedConsentRevision: input.item.consentRevision,
      checkedAt: input.now.toISOString(),
    });
  } catch {
    await finalizeSafely(
      input.repository,
      input.item,
      retryOrExhausted({
        item: input.item,
        now: input.now,
        random: input.random,
        errorCode: "ELIGIBILITY_TEMPORARY",
      }),
      input.counters,
    );
    return;
  }

  if (eligibility.kind === "LEASE_LOST") {
    input.counters.leaseLost += 1;
    return;
  }

  if (eligibility.kind === "SUPPRESSED") {
    await finalizeSafely(
      input.repository,
      input.item,
      { kind: "SUPPRESSED", reasonCode: eligibility.reasonCode },
      input.counters,
    );
    return;
  }

  let outcome: NotificationFinalizeOutcome;
  try {
    const deepLink = await input.deepLinkIssuer.issue({
      alertId: input.item.alertId,
      eventId: input.item.eventId,
      claimToken: input.item.claimToken,
      expectedLeaseUntil: input.item.leaseUntil,
    });

    // The link is issued only after the first check, and consent/lease are
    // checked again immediately before the provider side effect. The DB
    // access-token consumer also rejects a revoked/suppressed alert.
    const finalEligibility = await input.repository.recheckEligibility({
      alertId: input.item.alertId,
      claimToken: input.item.claimToken,
      expectedLeaseUntil: input.item.leaseUntil,
      expectedConsentRevision: input.item.consentRevision,
      checkedAt: input.clock().toISOString(),
    });
    if (finalEligibility.kind === "LEASE_LOST") {
      input.counters.leaseLost += 1;
      return;
    }
    if (finalEligibility.kind === "SUPPRESSED") {
      await finalizeSafely(
        input.repository,
        input.item,
        { kind: "SUPPRESSED", reasonCode: finalEligibility.reasonCode },
        input.counters,
      );
      return;
    }

    const result = await input.provider.sendGuardianAlert({
      alertId: input.item.alertId,
      eventId: input.item.eventId,
      recipientRef: input.item.recipientRef,
      channel: input.item.channel,
      templateKey: input.item.templateKey,
      riskLevel: input.item.riskLevel,
      deepLink,
      idempotencyKey: input.item.idempotencyKey,
    });
    outcome = providerOutcome({ item: input.item, result, now: input.now, random: input.random });
  } catch (error) {
    outcome = thrownOutcome({ item: input.item, error, now: input.now, random: input.random });
  }
  await finalizeSafely(input.repository, input.item, outcome, input.counters);
};

export const runDemoNotificationWorker = async (input: {
  readonly repository: NotificationRepository;
  readonly provider: NotificationProvider;
  readonly deepLinkIssuer: NotificationDeepLinkIssuer;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly limit?: number;
}): Promise<DemoNotificationWorkerResult> => {
  const clock = input.now ?? (() => new Date());
  const now = clock();
  const random = input.random ?? Math.random;
  const limit = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(input.limit ?? 20);
  const claimedItems: ClaimedGuardianAlert[] = [];
  for (let index = 0; index < limit; index += 1) {
    const claimNow = index === 0 ? now : clock();
    const claimLeaseUntil = new Date(claimNow.getTime() + LEASE_MS);
    let batch: readonly ClaimedGuardianAlert[];
    try {
      batch = await input.repository.claim({
        now: claimNow.toISOString(),
        leaseUntil: claimLeaseUntil.toISOString(),
        // One external side effect per lease prevents a slow item from
        // expiring leases for the rest of a large batch.
        limit: 1,
      });
    } catch {
      if (claimedItems.length === 0) {
        return Object.freeze({ kind: "TEMPORARY_FAILURE", code: "OUTBOX_UNAVAILABLE" });
      }
      break;
    }
    if (batch.length === 0) break;
    claimedItems.push(...batch);
  }

  const counters: WorkerCounters = {
    claimed: claimedItems.length,
    demoRecorded: 0,
    suppressed: 0,
    retryScheduled: 0,
    failedPermanent: 0,
    leaseLost: 0,
  };
  for (const item of claimedItems) {
    await processItem({
      repository: input.repository,
      provider: input.provider,
      deepLinkIssuer: input.deepLinkIssuer,
      item,
      now,
      clock,
      random,
      counters,
    });
  }
  return Object.freeze({ kind: "COMPLETED", ...counters });
};
