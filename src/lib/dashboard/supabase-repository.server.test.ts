import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { DashboardSearch } from "./search";
import { createSupabaseDashboardRepository } from "./supabase-repository.server";

type QueryResult = Readonly<{ data: unknown; error: { code?: string } | null }>;
type Script = Record<string, QueryResult[]>;

function scriptedClient(initialScript: Script) {
  const script = Object.fromEntries(
    Object.entries(initialScript).map(([table, results]) => [table, [...results]]),
  ) as Script;
  const calls: Array<readonly [string, string, ...unknown[]]> = [];
  const from = vi.fn((table: string) => {
    const result = script[table]?.shift();
    if (!result) throw new Error(`Unexpected query for ${table}`);

    const query = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") {
            return Promise.resolve(result).then.bind(Promise.resolve(result));
          }
          return (...args: unknown[]) => {
            calls.push([table, String(property), ...args]);
            return query;
          };
        },
      },
    );
    return query;
  });

  return { client: { from } as unknown as SupabaseClient, calls, from };
}

const ACTOR_ID = "00000000-0000-4000-8000-000000000102";
const SUBJECT_A = "10000000-0000-4000-8000-000000000001";
const SUBJECT_B = "10000000-0000-4000-8000-000000000002";
const TRANSITION_ACKED = "40000000-0000-4000-8000-000000000001";
const TRANSITION_UNREAD = "40000000-0000-4000-8000-000000000002";

const DEFAULT_SEARCH: DashboardSearch = {
  gu: "전체",
  level: "L3",
  sort: "hri",
  order: "desc",
};

function successfulScripts(
  eventAttestationUid:
    string | null = "0x7a3f9b21c4e5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9d2e1",
) {
  const session = scriptedClient({
    subjects: [
      {
        data: [
          { id: SUBJECT_A, lives_alone: true },
          { id: SUBJECT_B, lives_alone: false },
        ],
        error: null,
      },
    ],
    risk_snapshots: [
      {
        data: [
          {
            subject_id: SUBJECT_A,
            weather_snapshot_id: 11,
            hri: 91,
            level: "L4",
            reasons: ["환경 점수 (+50)"],
            computed_at: "2026-08-23T05:05:00.000Z",
          },
          {
            subject_id: SUBJECT_A,
            weather_snapshot_id: 10,
            hri: 71,
            level: "L3",
            reasons: ["이전 위험도"],
            computed_at: "2026-08-23T04:35:00.000Z",
          },
          {
            subject_id: SUBJECT_B,
            weather_snapshot_id: 12,
            hri: 76,
            level: "L3",
            reasons: ["개인 점수 (+20)"],
            computed_at: "2026-08-23T05:00:00.000Z",
          },
        ],
        error: null,
      },
    ],
    care_events: [
      {
        data: [
          {
            id: "50000000-0000-4000-8000-000000000001",
            subject_id: SUBJECT_B,
            alert_transition_id: TRANSITION_UNREAD,
            event_type: "ALERT_SENT",
            risk_level: "L4",
            hri: 88,
            occurred_at: "2026-08-23T05:04:00.000Z",
            attestation_state: eventAttestationUid === null ? "PENDING" : "VERIFIED",
            attestation_uid: eventAttestationUid,
          },
        ],
        error: null,
      },
    ],
    alert_transitions: [
      {
        data: [
          {
            id: TRANSITION_UNREAD,
            subject_id: SUBJECT_B,
            to_level: "L4",
            occurred_at: "2026-08-23T05:04:00.000Z",
          },
          {
            id: TRANSITION_ACKED,
            subject_id: SUBJECT_A,
            to_level: "L4",
            occurred_at: "2026-08-23T05:03:00.000Z",
          },
        ],
        error: null,
      },
    ],
    alert_transition_acknowledgements: [
      { data: [{ alert_transition_id: TRANSITION_ACKED }], error: null },
    ],
  });
  const admin = scriptedClient({
    subjects: [
      {
        data: [
          {
            id: SUBJECT_A,
            name: "김민수",
            birth_year: 1944,
            address: "대구광역시 수성구 범어동 123-4",
          },
          {
            id: SUBJECT_B,
            name: "박영희",
            birth_year: 1954,
            address: "대구광역시 중구 남산동 44",
          },
        ],
        error: null,
      },
    ],
    weather_snapshots: [
      {
        data: [
          {
            id: 11,
            feels_like_c: 39.2,
            advisory: "WARNING",
            observed_at: "2026-08-23T05:04:00.000Z",
            is_partial: false,
            is_stale: false,
          },
          {
            id: 12,
            feels_like_c: 37.8,
            advisory: "WATCH",
            observed_at: "2026-08-23T05:00:00.000Z",
            is_partial: true,
            is_stale: false,
          },
        ],
        error: null,
      },
    ],
  });
  return { session, admin };
}

describe("createSupabaseDashboardRepository", () => {
  it("batch-loads RLS-scoped rows, constrains admin lookups, and returns masked DTOs", async () => {
    const { session, admin } = successfulScripts();
    const repository = createSupabaseDashboardRepository(session.client, admin.client, {
      now: () => new Date("2026-08-23T05:10:00.000Z"),
    });

    const snapshot = await repository.read({ actorId: ACTOR_ID, search: DEFAULT_SEARCH });

    expect(snapshot.source).toBe("SUPABASE");
    expect(snapshot.weather).toEqual({
      gu: "대구 전체",
      feelsLikeC: 39.2,
      advisory: "WARNING",
      observedAt: "2026-08-23T05:04:00.000Z",
      isPartial: false,
      isStale: false,
    });
    expect(snapshot.urgentSubjects[0]).toMatchObject({
      id: SUBJECT_A,
      maskedName: "김○○",
      age: 82,
      gu: "수성구",
      locationLabel: "수성구 범어동",
      hri: 91,
      feelsLikeC: 39.2,
    });
    expect(snapshot.unreadL4Alerts).toEqual([
      expect.objectContaining({
        transitionId: TRANSITION_UNREAD,
        maskedName: "박○○",
        hri: 88,
      }),
    ]);
    expect(snapshot.careEvents).toEqual([
      expect.objectContaining({ typeLabel: "보호자 알림 발송", attest: "VERIFIED" }),
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(/김민수|박영희|123-4|대구광역시/);

    expect(session.calls).toContainEqual([
      "risk_snapshots",
      "in",
      "subject_id",
      [SUBJECT_A, SUBJECT_B],
    ]);
    expect(admin.calls).toContainEqual(["subjects", "in", "id", [SUBJECT_A, SUBJECT_B]]);
    expect(admin.calls).toContainEqual(["weather_snapshots", "in", "id", [11, 12]]);
    expect(session.from).toHaveBeenCalledTimes(5);
    expect(admin.from).toHaveBeenCalledTimes(2);
  });

  it("restores gu/level/sort/order entirely in the repository result", async () => {
    const { session, admin } = successfulScripts();
    const repository = createSupabaseDashboardRepository(session.client, admin.client, {
      now: () => new Date("2026-08-23T05:10:00.000Z"),
    });

    const snapshot = await repository.read({
      actorId: ACTOR_ID,
      search: { gu: "중구", level: "L3", sort: "age", order: "asc" },
    });

    expect(snapshot.filter).toEqual({ gu: "중구", level: "L3", sort: "age", order: "asc" });
    expect(snapshot.urgentSubjects).toHaveLength(1);
    expect(snapshot.urgentSubjects[0]).toMatchObject({ gu: "중구", age: 72 });
    expect(snapshot.weather?.gu).toBe("중구");
  });

  it("keeps an unverified event UUID separate instead of presenting it as an EAS UID", async () => {
    const { session, admin } = successfulScripts(null);
    const repository = createSupabaseDashboardRepository(session.client, admin.client, {
      now: () => new Date("2026-08-23T05:10:00.000Z"),
    });

    const snapshot = await repository.read({ actorId: ACTOR_ID, search: DEFAULT_SEARCH });

    expect(snapshot.careEvents[0]).toMatchObject({
      id: "50000000-0000-4000-8000-000000000001",
      attestationUid: null,
    });
    expect(snapshot.careEvents[0]).not.toHaveProperty("uid");
  });

  it("skips every admin query when RLS returns an empty subject allowlist", async () => {
    const session = scriptedClient({
      subjects: [{ data: [], error: null }],
    });
    const admin = scriptedClient({});
    const repository = createSupabaseDashboardRepository(session.client, admin.client);

    const snapshot = await repository.read({ actorId: ACTOR_ID, search: DEFAULT_SEARCH });

    expect(snapshot.summary.total).toBe(0);
    expect(snapshot.urgentSubjects).toEqual([]);
    expect(snapshot.weather).toBeNull();
    expect(admin.from).not.toHaveBeenCalled();
    expect(session.from).toHaveBeenCalledTimes(1);
  });

  it("maps provider and malformed PII responses to stable safe errors", async () => {
    const failedSession = scriptedClient({
      subjects: [{ data: null, error: { code: "RAW_PROVIDER_42501" } }],
    });
    const malformedScripts = successfulScripts();
    malformedScripts.admin = scriptedClient({
      subjects: [{ data: [{ id: SUBJECT_A, name: "RAW_SECRET" }], error: null }],
      weather_snapshots: [{ data: [], error: null }],
    });

    await expect(
      createSupabaseDashboardRepository(failedSession.client, scriptedClient({}).client).read({
        actorId: ACTOR_ID,
        search: DEFAULT_SEARCH,
      }),
    ).rejects.toMatchObject({ code: "SERVER_TEMPORARY", message: "SERVER_TEMPORARY" });
    await expect(
      createSupabaseDashboardRepository(
        malformedScripts.session.client,
        malformedScripts.admin.client,
      ).read({ actorId: ACTOR_ID, search: DEFAULT_SEARCH }),
    ).rejects.toMatchObject({ code: "SERVER_TEMPORARY", message: "SERVER_TEMPORARY" });
  });

  it("acknowledges an L4 transition with an actor-bound idempotent upsert", async () => {
    const session = scriptedClient({
      alert_transition_acknowledgements: [{ data: null, error: null }],
    });
    const repository = createSupabaseDashboardRepository(
      session.client,
      scriptedClient({}).client,
      {
        now: () => new Date("2026-08-23T05:10:00.000Z"),
      },
    );

    await repository.acknowledgeL4({ actorId: ACTOR_ID, transitionId: TRANSITION_UNREAD });

    expect(session.calls).toContainEqual([
      "alert_transition_acknowledgements",
      "upsert",
      {
        alert_transition_id: TRANSITION_UNREAD,
        profile_id: ACTOR_ID,
        acknowledged_at: "2026-08-23T05:10:00.000Z",
      },
      {
        onConflict: "alert_transition_id,profile_id",
        ignoreDuplicates: true,
      },
    ]);
  });
});
