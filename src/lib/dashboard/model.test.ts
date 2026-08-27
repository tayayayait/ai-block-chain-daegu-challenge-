import { describe, expect, it } from "vitest";

import type { DashboardSnapshot, DashboardSubject } from "./types";
import { dashboardAsyncState, formatDashboardUpdatedAt, newestUnreadL4Alert } from "./model";

const subject: DashboardSubject = {
  id: "subject-1",
  maskedName: "김○○",
  age: 82,
  livesAlone: true,
  gu: "수성구",
  locationLabel: "수성구",
  level: "L4",
  hri: 91,
  feelsLikeC: 39.2,
  reasons: ["폭염경보 발효 중"],
  updatedAt: "2026-08-23T05:03:00.000Z",
};

const snapshot: DashboardSnapshot = {
  source: "DEMO_FIXTURE",
  filter: { gu: "전체", level: "L3", sort: "hri", order: "desc" },
  summary: { total: 1, averageHri: 91, byLevel: { L2: 0, L3: 0, L4: 1 } },
  weather: {
    gu: "대구 전체",
    feelsLikeC: 39.2,
    advisory: "WARNING",
    observedAt: "2026-08-23T05:03:00.000Z",
    isPartial: false,
    isStale: false,
  },
  urgentSubjects: [subject],
  mapSubjects: [subject],
  careEvents: [],
  unreadL4Alerts: [
    {
      transitionId: "transition-old",
      subjectId: subject.id,
      maskedName: subject.maskedName,
      age: subject.age,
      hri: 88,
      occurredAt: "2026-08-23T04:00:00.000Z",
    },
    {
      transitionId: "transition-new",
      subjectId: subject.id,
      maskedName: subject.maskedName,
      age: subject.age,
      hri: subject.hri,
      occurredAt: "2026-08-23T05:03:00.000Z",
    },
  ],
  missingSources: [],
  fetchedAt: "2026-08-23T05:04:05.000Z",
};

describe("dashboard presentation model", () => {
  it("uses loading/error/empty/partial/refreshing/success states without discarding data", () => {
    expect(dashboardAsyncState({ isPending: true, isFetching: true })).toBe("loading");
    expect(dashboardAsyncState({ isPending: false, isFetching: false, isError: true })).toBe(
      "error",
    );
    expect(dashboardAsyncState({ isPending: false, isFetching: false, snapshot: null })).toBe(
      "empty",
    );
    expect(
      dashboardAsyncState({
        isPending: false,
        isFetching: false,
        snapshot: { ...snapshot, urgentSubjects: [] },
      }),
    ).toBe("empty");
    expect(
      dashboardAsyncState({
        isPending: false,
        isFetching: true,
        snapshot,
      }),
    ).toBe("refreshing");
    expect(
      dashboardAsyncState({
        isPending: false,
        isFetching: false,
        snapshot: { ...snapshot, missingSources: ["돌봄 기록"] },
      }),
    ).toBe("partial");
    expect(dashboardAsyncState({ isPending: false, isFetching: false, snapshot })).toBe("success");
  });

  it("chooses only the newest unread L4 transition for an assertive alert", () => {
    expect(newestUnreadL4Alert(snapshot)?.transitionId).toBe("transition-new");
    expect(newestUnreadL4Alert({ ...snapshot, unreadL4Alerts: [] })).toBeNull();
  });

  it("formats the last successful fetch in Korean KST", () => {
    expect(formatDashboardUpdatedAt(snapshot.fetchedAt)).toMatch(/2026\. 8\. 23\./);
    expect(formatDashboardUpdatedAt(snapshot.fetchedAt)).toMatch(/14:04/);
  });
});
