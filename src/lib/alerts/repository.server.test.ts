import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { AlertRepositoryError, createSupabaseAlertRepository } from "./repository.server";

const ALERT_ID = "123e4567-e89b-42d3-a456-426614174000";
const EVENT_ID = "123e4567-e89b-42d3-a456-426614174001";
const SUBJECT_ID = "123e4567-e89b-42d3-a456-426614174002";
const NOW = new Date("2026-08-23T12:00:00.000Z");
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174003";

type Result = Readonly<{ data: unknown; error: unknown | null }>;

function clientWith(input: {
  tables?: Readonly<Record<string, Result>>;
  rpc?: Result;
  calls?: Array<unknown>;
}): SupabaseClient {
  const calls = input.calls ?? [];
  const query = (table: string) => {
    const chain = {
      select(columns: string) {
        calls.push({ table, operation: "select", columns });
        return chain;
      },
      eq(column: string, value: unknown) {
        calls.push({ table, operation: "eq", column, value });
        return chain;
      },
      is(column: string, value: unknown) {
        calls.push({ table, operation: "is", column, value });
        return chain;
      },
      gt(column: string, value: unknown) {
        calls.push({ table, operation: "gt", column, value });
        return chain;
      },
      lte(column: string, value: unknown) {
        calls.push({ table, operation: "lte", column, value });
        return chain;
      },
      order(column: string, options: unknown) {
        calls.push({ table, operation: "order", column, options });
        return chain;
      },
      limit(value: number) {
        calls.push({ table, operation: "limit", value });
        return chain;
      },
      async maybeSingle() {
        return input.tables?.[table] ?? { data: null, error: null };
      },
      async insert(value: unknown) {
        calls.push({ table, operation: "insert", value });
        return input.tables?.[table] ?? { data: null, error: null };
      },
    };
    return chain;
  };

  return {
    from: vi.fn(query),
    rpc: vi.fn(async (name: string, parameters: unknown) => {
      calls.push({ operation: "rpc", name, parameters });
      return input.rpc ?? { data: null, error: null };
    }),
  } as unknown as SupabaseClient;
}

describe("Supabase alert access/detail repository", () => {
  it("replaces sibling unconsumed grants through one service-role RPC", async () => {
    const calls: Array<unknown> = [];
    const repository = createSupabaseAlertRepository(
      clientWith({ calls, rpc: { data: true, error: null } }),
    );
    const expiresAt = new Date(NOW.getTime() + 86_400_000);

    await expect(
      repository.saveGrant({
        alertId: ALERT_ID,
        eventId: EVENT_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: new Date(NOW.getTime() + 4 * 60_000),
        tokenHash: "a".repeat(64),
        expiresAt,
      }),
    ).resolves.toBeUndefined();

    expect(calls).toContainEqual({
      operation: "rpc",
      name: "replace_alert_access_grant",
      parameters: {
        p_alert_id: ALERT_ID,
        p_event_id: EVENT_ID,
        p_claim_token: CLAIM_TOKEN,
        p_expected_lease_until: new Date(NOW.getTime() + 4 * 60_000).toISOString(),
        p_token_hash: "a".repeat(64),
        p_expires_at: expiresAt.toISOString(),
      },
    });
    expect(calls).not.toContainEqual(expect.objectContaining({ operation: "insert" }));
  });

  it("uses the atomic consume RPC and resolves only the matching live hashed session", async () => {
    const calls: Array<unknown> = [];
    const repository = createSupabaseAlertRepository(
      clientWith({
        calls,
        rpc: { data: true, error: null },
        tables: {
          alert_access_sessions: {
            data: { alert_id: ALERT_ID, event_id: EVENT_ID },
            error: null,
          },
        },
      }),
    );

    await expect(
      repository.consumeOnceAndCreateSession({
        tokenHash: "a".repeat(64),
        eventId: EVENT_ID,
        now: NOW,
        sessionHash: "b".repeat(64),
        sessionExpiresAt: new Date(NOW.getTime() + 86_400_000),
      }),
    ).resolves.toBe(true);
    await expect(
      repository.findValidSession({
        sessionHash: "b".repeat(64),
        eventId: EVENT_ID,
        now: NOW,
      }),
    ).resolves.toEqual({ alertId: ALERT_ID, eventId: EVENT_ID });

    expect(calls).toContainEqual({
      operation: "rpc",
      name: "consume_alert_access_token",
      parameters: {
        p_token_hash: "a".repeat(64),
        p_event_id: EVENT_ID,
        p_now: NOW.toISOString(),
        p_session_hash: "b".repeat(64),
        p_session_expires_at: new Date(NOW.getTime() + 86_400_000).toISOString(),
      },
    });
    expect(JSON.stringify(calls)).not.toMatch(/010-|opaque-token|guardian_phone/iu);
  });

  it("reads only the event-bound subject name and matching historical risk snapshot", async () => {
    const calls: Array<unknown> = [];
    const repository = createSupabaseAlertRepository(
      clientWith({
        calls,
        tables: {
          guardian_alerts: {
            data: {
              id: ALERT_ID,
              alert_transition_id: EVENT_ID,
              subject_id: SUBJECT_ID,
              risk_level: "L4",
            },
            error: null,
          },
          alert_transitions: {
            data: {
              id: EVENT_ID,
              subject_id: SUBJECT_ID,
              to_level: "L4",
              occurred_at: NOW.toISOString(),
            },
            error: null,
          },
          subjects: { data: { id: SUBJECT_ID, name: "김온중" }, error: null },
          risk_snapshots: {
            data: {
              subject_id: SUBJECT_ID,
              hri: 82,
              level: "L4",
              reasons: ["체감 39.2℃ + 폭염경보 (+31)"],
              computed_at: NOW.toISOString(),
            },
            error: null,
          },
        },
      }),
    );

    await expect(
      repository.findByAccess({ alertId: ALERT_ID, eventId: EVENT_ID }),
    ).resolves.toEqual({
      alertId: ALERT_ID,
      eventId: EVENT_ID,
      subjectId: SUBJECT_ID,
      subjectName: "김온중",
      riskLevel: "L4",
      hri: 82,
      occurredAt: NOW.toISOString(),
      reasons: ["체감 39.2℃ + 폭염경보 (+31)"],
    });

    const serialized = JSON.stringify(calls);
    expect(serialized).toContain('"columns":"id,name"');
    expect(serialized).not.toMatch(/address|phone|guardian_phone/iu);
  });

  it("resolves an alert subject session through a strict service-role RPC response", async () => {
    const calls: Array<unknown> = [];
    const expiresAt = "2026-08-24T12:00:00.000Z";
    const sessionId = "123e4567-e89b-42d3-a456-426614174003";
    const repository = createSupabaseAlertRepository(
      clientWith({
        calls,
        rpc: {
          data: [{ session_id: sessionId, subject_id: SUBJECT_ID, expires_at: expiresAt }],
          error: null,
        },
      }),
    );

    await expect(
      repository.findSubjectSession({ sessionHash: "c".repeat(64), now: NOW }),
    ).resolves.toEqual({ sessionId, subjectId: SUBJECT_ID, expiresAt: new Date(expiresAt) });
    expect(calls).toContainEqual({
      operation: "rpc",
      name: "resolve_alert_subject_session",
      parameters: { p_session_hash: "c".repeat(64), p_now: NOW.toISOString() },
    });
    expect(JSON.stringify(calls)).not.toMatch(/event_id|alert_id|phone/iu);
  });

  it("rejects over-posted subject session RPC fields", async () => {
    const repository = createSupabaseAlertRepository(
      clientWith({
        rpc: {
          data: [
            {
              session_id: "123e4567-e89b-42d3-a456-426614174003",
              subject_id: SUBJECT_ID,
              expires_at: "2026-08-24T12:00:00.000Z",
              event_id: EVENT_ID,
            },
          ],
          error: null,
        },
      }),
    );

    await expect(
      repository.findSubjectSession({ sessionHash: "c".repeat(64), now: NOW }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects extra private fields and replaces database diagnostics with stable errors", async () => {
    const malformed = createSupabaseAlertRepository(
      clientWith({
        tables: {
          alert_access_sessions: {
            data: { alert_id: ALERT_ID, event_id: EVENT_ID, phone: "010-1234-5678" },
            error: null,
          },
        },
      }),
    );
    const failed = createSupabaseAlertRepository(
      clientWith({
        tables: {
          alert_access_sessions: {
            data: null,
            error: { message: "token=private phone=010-1234-5678" },
          },
        },
      }),
    );

    const malformedError = await malformed
      .findValidSession({ sessionHash: "b".repeat(64), eventId: EVENT_ID, now: NOW })
      .catch((error: unknown) => error);
    const queryError = await failed
      .findValidSession({ sessionHash: "b".repeat(64), eventId: EVENT_ID, now: NOW })
      .catch((error: unknown) => error);

    expect(malformedError).toBeInstanceOf(AlertRepositoryError);
    expect(malformedError).toMatchObject({ code: "INVALID_RESPONSE", message: "INVALID_RESPONSE" });
    expect(queryError).toMatchObject({ code: "QUERY_FAILED", message: "QUERY_FAILED" });
    expect(JSON.stringify([malformedError, queryError])).not.toMatch(/010-|private|token/iu);
  });
});
