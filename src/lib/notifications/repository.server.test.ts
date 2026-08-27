import { describe, expect, it } from "vitest";

import {
  NotificationRepositoryError,
  createSupabaseNotificationRepository,
  type NotificationRpcClient,
} from "./repository.server";

const ALERT_ID = "123e4567-e89b-42d3-a456-426614174000";
const EVENT_ID = "123e4567-e89b-42d3-a456-426614174001";
const LEASE_UNTIL = "2026-08-24T00:01:00.000Z";
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174002";

const claimedRow = {
  alert_id: ALERT_ID,
  event_id: EVENT_ID,
  recipient_ref: "a".repeat(64),
  channel: "SMS",
  template_key: "HEAT_L3",
  risk_level: "L3",
  idempotency_key: "subject:episode:L3:ENTER",
  attempt_count: 1,
  lease_until: LEASE_UNTIL,
  claim_token: CLAIM_TOKEN,
  consent_revision: 3,
};

const clientWith = (
  responses: Readonly<Record<string, { data: unknown; error: unknown | null }>>,
  calls: Array<{ name: string; parameters: Readonly<Record<string, unknown>> }> = [],
): NotificationRpcClient => ({
  rpc: async (name, parameters) => {
    calls.push({ name, parameters });
    return (
      responses[name] ?? { data: null, error: { code: "MISSING_FIXTURE", secret: "do-not-leak" } }
    );
  },
});

describe("Supabase guardian notification repository", () => {
  it("claims due rows through a bounded lease RPC and returns a strict safe DTO", async () => {
    const calls: Array<{ name: string; parameters: Readonly<Record<string, unknown>> }> = [];
    const repository = createSupabaseNotificationRepository(
      clientWith(
        {
          claim_guardian_alert_outbox: { data: [claimedRow], error: null },
        },
        calls,
      ),
    );

    await expect(
      repository.claim({
        now: "2026-08-24T00:00:00.000Z",
        leaseUntil: LEASE_UNTIL,
        limit: 20,
      }),
    ).resolves.toEqual([
      {
        alertId: ALERT_ID,
        eventId: EVENT_ID,
        recipientRef: "a".repeat(64),
        channel: "SMS",
        templateKey: "HEAT_L3",
        riskLevel: "L3",
        idempotencyKey: "subject:episode:L3:ENTER",
        attemptCount: 1,
        leaseUntil: LEASE_UNTIL,
        claimToken: CLAIM_TOKEN,
        consentRevision: 3,
      },
    ]);
    expect(calls).toEqual([
      {
        name: "claim_guardian_alert_outbox",
        parameters: {
          p_now: "2026-08-24T00:00:00.000Z",
          p_lease_until: LEASE_UNTIL,
          p_limit: 20,
        },
      },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/010-|token|secret/i);
  });

  it("rejects malformed or over-broad claim responses instead of passing them upward", async () => {
    const repository = createSupabaseNotificationRepository(
      clientWith({
        claim_guardian_alert_outbox: {
          data: [
            { ...claimedRow, recipient_ref: "010-1234-5678", guardian_phone: "010-9999-9999" },
          ],
          error: null,
        },
      }),
    );

    await expect(
      repository.claim({
        now: "2026-08-24T00:00:00.000Z",
        leaseUntil: LEASE_UNTIL,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rechecks consent and channel suppression immediately before provider use", async () => {
    const calls: Array<{ name: string; parameters: Readonly<Record<string, unknown>> }> = [];
    const repository = createSupabaseNotificationRepository(
      clientWith(
        {
          recheck_guardian_alert_eligibility: {
            data: [{ disposition: "SUPPRESSED", reason_code: "CONSENT_WITHDRAWN" }],
            error: null,
          },
        },
        calls,
      ),
    );

    await expect(
      repository.recheckEligibility({
        alertId: ALERT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: LEASE_UNTIL,
        expectedConsentRevision: 3,
        checkedAt: "2026-08-24T00:00:30.000Z",
      }),
    ).resolves.toEqual({ kind: "SUPPRESSED", reasonCode: "CONSENT_WITHDRAWN" });
    expect(calls).toEqual([
      {
        name: "recheck_guardian_alert_eligibility",
        parameters: {
          p_alert_id: ALERT_ID,
          p_claim_token: CLAIM_TOKEN,
          p_expected_lease_until: LEASE_UNTIL,
          p_expected_consent_revision: 3,
          p_checked_at: "2026-08-24T00:00:30.000Z",
        },
      },
    ]);
  });

  it("finalizes only demo-safe terminal or durable retry states with lease compare-and-set", async () => {
    const calls: Array<{ name: string; parameters: Readonly<Record<string, unknown>> }> = [];
    const repository = createSupabaseNotificationRepository(
      clientWith(
        {
          finalize_guardian_alert_outbox: {
            data: [{ disposition: "APPLIED", status: "DEMO_RECORDED" }],
            error: null,
          },
        },
        calls,
      ),
    );

    await expect(
      repository.finalize({
        alertId: ALERT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: LEASE_UNTIL,
        outcome: {
          kind: "DEMO_RECORDED",
          providerMessageId: `demo_${"b".repeat(64)}`,
          recordedAt: "2026-08-24T00:00:01.000Z",
        },
      }),
    ).resolves.toEqual({ disposition: "APPLIED", status: "DEMO_RECORDED" });

    expect(calls[0]).toEqual({
      name: "finalize_guardian_alert_outbox",
      parameters: {
        p_alert_id: ALERT_ID,
        p_claim_token: CLAIM_TOKEN,
        p_expected_lease_until: LEASE_UNTIL,
        p_outcome: {
          kind: "DEMO_RECORDED",
          provider_message_id: `demo_${"b".repeat(64)}`,
          recorded_at: "2026-08-24T00:00:01.000Z",
        },
      },
    });
    expect(JSON.stringify(calls)).not.toMatch(/accepted|delivered|alert_sent|010-|opaque/i);
  });

  it("rejects a live-only finalize request before it reaches Supabase", async () => {
    const calls: Array<{ name: string; parameters: Readonly<Record<string, unknown>> }> = [];
    const repository = createSupabaseNotificationRepository(clientWith({}, calls));

    await expect(
      repository.finalize({
        alertId: ALERT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: LEASE_UNTIL,
        outcome: { kind: "ACCEPTED", providerMessageId: "provider-secret" },
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(calls).toHaveLength(0);
  });

  it("maps database and response failures to non-sensitive stable errors", async () => {
    const failed = createSupabaseNotificationRepository(
      clientWith({
        claim_guardian_alert_outbox: {
          data: null,
          error: { message: "guardian 010-1234-5678 token=opaque", details: "private" },
        },
      }),
    );
    const invalid = createSupabaseNotificationRepository(
      clientWith({
        recheck_guardian_alert_eligibility: {
          data: [{ disposition: "ELIGIBLE", reason_code: "SHOULD_BE_NULL", extra: "secret" }],
          error: null,
        },
      }),
    );

    const queryError = await failed
      .claim({ now: "2026-08-24T00:00:00.000Z", leaseUntil: LEASE_UNTIL, limit: 1 })
      .catch((error: unknown) => error);
    const responseError = await invalid
      .recheckEligibility({
        alertId: ALERT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: LEASE_UNTIL,
        expectedConsentRevision: 3,
        checkedAt: "2026-08-24T00:00:30.000Z",
      })
      .catch((error: unknown) => error);

    expect(queryError).toBeInstanceOf(NotificationRepositoryError);
    expect(queryError).toMatchObject({ code: "QUERY_FAILED", message: "QUERY_FAILED" });
    expect(responseError).toMatchObject({ code: "INVALID_RESPONSE", message: "INVALID_RESPONSE" });
    expect(JSON.stringify([queryError, responseError])).not.toMatch(/010-|opaque|private|secret/i);
  });
});
