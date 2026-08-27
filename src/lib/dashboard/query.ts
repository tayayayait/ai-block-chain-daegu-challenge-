import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import type { DashboardSearch } from "./search";
import type { DashboardSnapshot } from "./types";

export const DASHBOARD_REFETCH_MS = 30_000;

export const dashboardQueryKeys = Object.freeze({
  all: ["dashboard"] as const,
  snapshot: (search: DashboardSearch) => ["dashboard", "snapshot", search] as const,
});

export type DashboardFetcher = (search: DashboardSearch) => Promise<DashboardSnapshot>;

export function dashboardQueryOptions(search: DashboardSearch, fetcher: DashboardFetcher) {
  return queryOptions({
    queryKey: dashboardQueryKeys.snapshot(search),
    queryFn: () => fetcher(search),
    refetchInterval: DASHBOARD_REFETCH_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}
