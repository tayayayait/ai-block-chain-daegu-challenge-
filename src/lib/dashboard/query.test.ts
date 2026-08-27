import { describe, expect, it, vi } from "vitest";

import { DASHBOARD_REFETCH_MS, dashboardQueryOptions, dashboardQueryKeys } from "./query";

const search = { gu: "수성구", level: "L3", sort: "hri", order: "desc" } as const;

describe("dashboard query policy", () => {
  it("uses a domain key containing every shareable URL filter", () => {
    expect(dashboardQueryKeys.snapshot(search)).toEqual(["dashboard", "snapshot", search]);
  });

  it("refetches real data every 30 seconds and keeps the previous snapshot", async () => {
    const fetcher = vi.fn().mockResolvedValue({ fetchedAt: "2026-08-23T05:04:05.000Z" });
    const options = dashboardQueryOptions(search, fetcher);

    expect(options.refetchInterval).toBe(DASHBOARD_REFETCH_MS);
    expect(DASHBOARD_REFETCH_MS).toBe(30_000);
    expect(typeof options.placeholderData).toBe("function");
    if (typeof options.placeholderData !== "function") {
      throw new Error("Dashboard queries must retain previous data while refreshing");
    }
    expect(options.placeholderData({ old: true } as never, undefined as never)).toEqual({
      old: true,
    });
    await options.queryFn?.({ signal: new AbortController().signal } as never);
    expect(fetcher).toHaveBeenCalledWith(search);
  });
});
