import { describe, expect, it, vi } from "vitest";

import {
  createDemoNotificationProvider,
  type DemoNotificationRecord,
} from "./demo-provider.server";
import type { NotificationProvider } from "./provider";
import type {
  ClaimedGuardianAlert,
  NotificationFinalizeCommand,
  NotificationFinalizeResult,
  NotificationRepository,
} from "./repository.server";
import { runDemoNotificationWorker } from "./worker.server";

const ALERT_ID = "123e4567-e89b-42d3-a456-426614174000";
const EVENT_ID = "123e4567-e89b-42d3-a456-426614174001";
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174002";

const item = (attemptCount = 1): ClaimedGuardianAlert => ({
  alertId: ALERT_ID,
  eventId: EVENT_ID,
  recipientRef: "a".repeat(64),
  channel: "SMS",
  templateKey: "HEAT_L3",
  riskLevel: "L3",
  idempotencyKey: "subject:episode:L3:ENTER",
  attemptCount,
  leaseUntil: "2026-08-24T00:04:00.000Z",
  claimToken: CLAIM_TOKEN,
  consentRevision: 3,
});

const createDemoRepository = () => {
  const records = new Map<string, DemoNotificationRecord>();
  return {
    records,
    findByIdempotencyKey: async (key: string) => records.get(key) ?? null,
    insertOnce: async (record: DemoNotificationRecord) => {
      const existing = records.get(record.idempotencyKey);
      if (existing) return existing;
      records.set(record.idempotencyKey, record);
      return record;
    },
  };
};

const createOutboxRepository = (options?: {
  eligibility?: Awaited<ReturnType<NotificationRepository["recheckEligibility"]>>;
  eligibilities?: readonly Awaited<ReturnType<NotificationRepository["recheckEligibility"]>>[];
  finalizeResult?: NotificationFinalizeResult;
  claimed?: readonly ClaimedGuardianAlert[];
}) => {
  const finalizations: NotificationFinalizeCommand[] = [];
  const claimCalls: Array<Parameters<NotificationRepository["claim"]>[0]> = [];
  const eligibilityCalls: Array<Parameters<NotificationRepository["recheckEligibility"]>[0]> = [];
  const remaining = [...(options?.claimed ?? [item()])];
  let eligibilityIndex = 0;
  const repository: NotificationRepository = {
    claim: async (input) => {
      claimCalls.push(input);
      const next = remaining.shift();
      return next ? [next] : [];
    },
    recheckEligibility: async (input) => {
      eligibilityCalls.push(input);
      return (
        options?.eligibilities?.[eligibilityIndex++] ?? options?.eligibility ?? { kind: "ELIGIBLE" }
      );
    },
    finalize: async (command) => {
      finalizations.push(command);
      return options?.finalizeResult ?? { disposition: "APPLIED", status: command.outcome.kind };
    },
  };
  return { repository, finalizations, claimCalls, eligibilityCalls };
};

const run = async (input: {
  repository: NotificationRepository;
  provider: NotificationProvider;
  now?: () => Date;
  random?: () => number;
  issued?: Array<unknown>;
}) =>
  runDemoNotificationWorker({
    ...input,
    deepLinkIssuer: {
      issue: async (issueInput) => {
        input.issued?.push(issueInput);
        return `https://demo.onjung.example/alert/${issueInput.eventId}?token=opaque-secret-token`;
      },
    },
    now: input.now ?? (() => new Date("2026-08-24T00:00:00.000Z")),
    random: input.random ?? (() => 0),
    limit: 10,
  });

describe("demo guardian notification outbox worker", () => {
  it("rechecks eligibility, calls the real demo provider with zero network, and records only DEMO_RECORDED", async () => {
    const outbox = createOutboxRepository();
    const demo = createDemoRepository();
    const issued: Array<unknown> = [];
    const provider = createDemoNotificationProvider({
      repository: demo,
      allowedOrigin: "https://demo.onjung.example",
      now: () => new Date("2026-08-24T00:00:01.000Z"),
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await run({ repository: outbox.repository, provider, issued });

    expect(result).toEqual({
      kind: "COMPLETED",
      claimed: 1,
      demoRecorded: 1,
      suppressed: 0,
      retryScheduled: 0,
      failedPermanent: 0,
      leaseLost: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(demo.records).toHaveLength(1);
    expect(outbox.finalizations).toEqual([
      {
        alertId: ALERT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: "2026-08-24T00:04:00.000Z",
        outcome: {
          kind: "DEMO_RECORDED",
          providerMessageId: expect.stringMatching(/^demo_[0-9a-f]{64}$/),
          recordedAt: "2026-08-24T00:00:01.000Z",
        },
      },
    ]);
    expect(outbox.claimCalls).toEqual([
      {
        now: "2026-08-24T00:00:00.000Z",
        leaseUntil: "2026-08-24T00:04:00.000Z",
        limit: 1,
      },
      {
        now: "2026-08-24T00:00:00.000Z",
        leaseUntil: "2026-08-24T00:04:00.000Z",
        limit: 1,
      },
    ]);
    expect(outbox.eligibilityCalls).toHaveLength(2);
    expect(issued).toEqual([
      {
        alertId: ALERT_ID,
        eventId: EVENT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: "2026-08-24T00:04:00.000Z",
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /accepted|delivered|alert_sent|opaque-secret-token|010-/i,
    );
    fetchSpy.mockRestore();
  });

  it("suppresses a withdrawn recipient before issuing a link or calling the provider", async () => {
    const outbox = createOutboxRepository({
      eligibility: { kind: "SUPPRESSED", reasonCode: "CONSENT_WITHDRAWN" },
    });
    const provider: NotificationProvider = { sendGuardianAlert: vi.fn() };

    const result = await run({ repository: outbox.repository, provider });

    expect(provider.sendGuardianAlert).not.toHaveBeenCalled();
    expect(outbox.finalizations).toEqual([
      {
        alertId: ALERT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: "2026-08-24T00:04:00.000Z",
        outcome: { kind: "SUPPRESSED", reasonCode: "CONSENT_WITHDRAWN" },
      },
    ]);
    expect(result).toMatchObject({ kind: "COMPLETED", suppressed: 1 });
  });

  it("rechecks consent after issuing the one-time link and suppresses a changed preference", async () => {
    const outbox = createOutboxRepository({
      eligibilities: [{ kind: "ELIGIBLE" }, { kind: "SUPPRESSED", reasonCode: "CONSENT_CHANGED" }],
    });
    const provider: NotificationProvider = { sendGuardianAlert: vi.fn() };

    const result = await run({ repository: outbox.repository, provider });

    expect(provider.sendGuardianAlert).not.toHaveBeenCalled();
    expect(outbox.eligibilityCalls).toHaveLength(2);
    expect(outbox.finalizations).toEqual([
      {
        alertId: ALERT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: "2026-08-24T00:04:00.000Z",
        outcome: { kind: "SUPPRESSED", reasonCode: "CONSENT_CHANGED" },
      },
    ]);
    expect(result).toMatchObject({ kind: "COMPLETED", suppressed: 1 });
  });

  it("stores a durable exponential retry without exposing a provider error", async () => {
    const outbox = createOutboxRepository();
    const provider: NotificationProvider = {
      sendGuardianAlert: async () => ({
        kind: "retryable-failure",
        code: "timeout token=opaque 010-1234-5678",
      }),
    };

    const result = await run({ repository: outbox.repository, provider, random: () => 0 });

    expect(outbox.finalizations).toEqual([
      {
        alertId: ALERT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: "2026-08-24T00:04:00.000Z",
        outcome: {
          kind: "RETRY_WAIT",
          errorCode: "PROVIDER_RETRYABLE",
          nextAttemptAt: "2026-08-24T00:00:02.000Z",
        },
      },
    ]);
    expect(result).toMatchObject({ kind: "COMPLETED", retryScheduled: 1 });
    expect(JSON.stringify([result, outbox.finalizations])).not.toMatch(/opaque|010-/i);
  });

  it("honors a larger retry-after and stops after the third claimed attempt", async () => {
    const retryOutbox = createOutboxRepository({ claimed: [item(2)] });
    const exhaustedOutbox = createOutboxRepository({ claimed: [item(3)] });
    const provider: NotificationProvider = {
      sendGuardianAlert: async () => ({
        kind: "retryable-failure",
        code: "HTTP_503",
        retryAfterSeconds: 30,
      }),
    };

    await run({ repository: retryOutbox.repository, provider, random: () => 0 });
    await run({ repository: exhaustedOutbox.repository, provider, random: () => 0 });

    expect(retryOutbox.finalizations[0]?.outcome).toEqual({
      kind: "RETRY_WAIT",
      errorCode: "HTTP_503",
      nextAttemptAt: "2026-08-24T00:00:30.000Z",
    });
    expect(exhaustedOutbox.finalizations[0]?.outcome).toEqual({
      kind: "FAILED_PERMANENT",
      errorCode: "RETRY_EXHAUSTED",
    });
  });

  it("turns an impossible live acceptance into a permanent demo-mode failure", async () => {
    const outbox = createOutboxRepository();
    const provider: NotificationProvider = {
      sendGuardianAlert: async () => ({
        kind: "accepted",
        providerMessageId: "live-provider-id",
        acceptedAt: "2026-08-24T00:00:01.000Z",
      }),
    };

    const result = await run({ repository: outbox.repository, provider });

    expect(outbox.finalizations[0]?.outcome).toEqual({
      kind: "FAILED_PERMANENT",
      errorCode: "LIVE_RESULT_IN_DEMO_MODE",
    });
    expect(result).toMatchObject({ kind: "COMPLETED", failedPermanent: 1 });
    expect(JSON.stringify(result)).not.toMatch(/accepted|delivered|alert_sent/i);
  });

  it("uses a safe retry for unexpected throws and reports a stale finalize as lease loss", async () => {
    const outbox = createOutboxRepository({
      finalizeResult: { disposition: "LEASE_LOST", status: "PROCESSING" },
    });
    const provider: NotificationProvider = {
      sendGuardianAlert: async () => {
        throw new Error("token=opaque guardian=010-1234-5678");
      },
    };

    const result = await run({ repository: outbox.repository, provider });

    expect(outbox.finalizations[0]?.outcome).toEqual({
      kind: "RETRY_WAIT",
      errorCode: "PROVIDER_TEMPORARY",
      nextAttemptAt: "2026-08-24T00:00:02.000Z",
    });
    expect(result).toMatchObject({ kind: "COMPLETED", retryScheduled: 0, leaseLost: 1 });
    expect(JSON.stringify([result, outbox.finalizations])).not.toMatch(/opaque|010-/i);
  });

  it("returns a stable non-sensitive result when claiming is temporarily unavailable", async () => {
    const repository: NotificationRepository = {
      claim: async () => {
        throw new Error("database secret token=opaque 010-1234-5678");
      },
      recheckEligibility: async () => ({ kind: "ELIGIBLE" }),
      finalize: async () => ({ disposition: "APPLIED", status: "DEMO_RECORDED" }),
    };
    const provider: NotificationProvider = { sendGuardianAlert: vi.fn() };

    const result = await run({ repository, provider });

    expect(result).toEqual({ kind: "TEMPORARY_FAILURE", code: "OUTBOX_UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toMatch(/opaque|010-|secret/i);
  });
});
