import type { AsyncState } from "@/lib/domain-types";

import type { DashboardL4Alert, DashboardSnapshot } from "./types";

export interface DashboardQueryState {
  isPending: boolean;
  isFetching: boolean;
  isError?: boolean;
  snapshot?: DashboardSnapshot | null;
}

export function dashboardAsyncState(state: DashboardQueryState): AsyncState {
  if (state.isPending && !state.snapshot) return "loading";
  if (state.isError && !state.snapshot) return "error";
  if (!state.snapshot || state.snapshot.urgentSubjects.length === 0) return "empty";
  if (state.snapshot.missingSources.length > 0) return "partial";
  if (state.isFetching) return "refreshing";
  return "success";
}

export function newestUnreadL4Alert(snapshot: DashboardSnapshot): DashboardL4Alert | null {
  return (
    [...snapshot.unreadL4Alerts].sort(
      (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    )[0] ?? null
  );
}

const KST_DATE_TIME = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDashboardUpdatedAt(isoTimestamp: string): string {
  const timestamp = new Date(isoTimestamp);
  return Number.isNaN(timestamp.getTime()) ? "시각 확인 불가" : KST_DATE_TIME.format(timestamp);
}
