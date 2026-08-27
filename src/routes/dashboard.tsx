import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ShadeShell } from "@/components/onjung/Shells";
import { Btn } from "@/components/onjung/Btn";
import type { RiskLevel } from "@/lib/domain-types";
import { DashboardView } from "@/lib/dashboard/DashboardView";
import { dashboardAsyncState } from "@/lib/dashboard/model";
import { dashboardQueryKeys, dashboardQueryOptions } from "@/lib/dashboard/query";
import {
  DASHBOARD_LEVELS,
  DASHBOARD_ORDERS,
  DASHBOARD_SORTS,
  DAEGU_GU,
  dashboardSearchSchema,
  type DashboardSearch,
} from "@/lib/dashboard/search";
import { protectedLocationPath, requireStaffRouteAccess } from "@/lib/auth/route-access";
import { acknowledgeDashboardL4, fetchDashboardSnapshot } from "@/lib/dashboard/server-functions";

const fetchDashboard = (search: DashboardSearch) => fetchDashboardSnapshot({ data: search });

export const Route = createFileRoute("/dashboard")({
  validateSearch: dashboardSearchSchema,
  beforeLoad: async ({ location }) => {
    await requireStaffRouteAccess(protectedLocationPath(location));
  },
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ context, deps }) => {
    try {
      return await context.queryClient.ensureQueryData(
        dashboardQueryOptions(deps.search, fetchDashboard),
      );
    } catch {
      return null;
    }
  },
  head: () => ({
    meta: [
      { title: "관제 대시보드 — 온중 溫證" },
      {
        name: "description",
        content:
          "대구 폭염 취약 어르신의 개인별 위험도(HRI)를 30초마다 갱신해 즉시 조치가 필요한 대상자를 상단에 노출합니다.",
      },
      { property: "og:title", content: "관제 대시보드 — 온중 溫證" },
      {
        property: "og:description",
        content: "L3 이상 대상자, 위험도 목록, 최근 온체인 돌봄 기록을 한 화면에서 관제합니다.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function DashboardFilters({
  search,
  onChange,
}: {
  search: DashboardSearch;
  onChange: (next: Partial<DashboardSearch>) => void;
}) {
  return (
    <section className="border-border bg-raised rounded-lg border p-4" aria-label="대시보드 필터">
      <div className="flex flex-wrap gap-2" role="group" aria-label="구·군 필터">
        {DAEGU_GU.map((gu) => (
          <button
            key={gu}
            type="button"
            aria-pressed={search.gu === gu}
            onClick={() => onChange({ gu })}
            className="t-caption border-border h-9 rounded-full border px-3 font-semibold"
            style={
              search.gu === gu
                ? { backgroundColor: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }
                : { color: "var(--fg-2)" }
            }
          >
            {gu}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <label className="t-caption flex items-center gap-2">
          최소 위험 등급
          <select
            value={search.level}
            onChange={(event) =>
              onChange({
                level: event.currentTarget.value as Extract<RiskLevel, DashboardSearch["level"]>,
              })
            }
            className="border-border bg-background h-10 rounded-md border px-3"
          >
            {DASHBOARD_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>

        <label className="t-caption flex items-center gap-2">
          정렬 기준
          <select
            value={search.sort}
            onChange={(event) =>
              onChange({ sort: event.currentTarget.value as DashboardSearch["sort"] })
            }
            className="border-border bg-background h-10 rounded-md border px-3"
          >
            {DASHBOARD_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {{ hri: "HRI", age: "나이", updated: "최근 갱신" }[sort]}
              </option>
            ))}
          </select>
        </label>

        <label className="t-caption flex items-center gap-2">
          정렬 방향
          <select
            value={search.order}
            onChange={(event) =>
              onChange({ order: event.currentTarget.value as DashboardSearch["order"] })
            }
            className="border-border bg-background h-10 rounded-md border px-3"
          >
            {DASHBOARD_ORDERS.map((order) => (
              <option key={order} value={order}>
                {order === "desc" ? "내림차순" : "오름차순"}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function Dashboard() {
  const search = Route.useSearch();
  const initialSnapshot = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const dashboardQuery = useQuery({
    ...dashboardQueryOptions(search, fetchDashboard),
    ...(initialSnapshot ? { initialData: initialSnapshot } : {}),
  });
  const acknowledgeMutation = useMutation({
    mutationFn: (transitionId: string) => acknowledgeDashboardL4({ data: { transitionId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.all }),
  });

  const staleSnapshot = dashboardQuery.data ?? null;
  const snapshot =
    dashboardQuery.isError && staleSnapshot
      ? {
          ...staleSnapshot,
          missingSources: [...staleSnapshot.missingSources, "최신 갱신"],
        }
      : staleSnapshot;
  const state = dashboardAsyncState({
    isPending: dashboardQuery.isPending,
    isFetching: dashboardQuery.isFetching,
    isError: dashboardQuery.isError,
    snapshot,
  });

  const updateSearch = (next: Partial<DashboardSearch>) => {
    void navigate({
      search: (previous) => dashboardSearchSchema.parse({ ...previous, ...next }),
    });
  };

  return (
    <ShadeShell weather={snapshot?.weather ?? null}>
      <DashboardView
        snapshot={snapshot}
        state={state}
        onRetry={() => void dashboardQuery.refetch()}
        onAcknowledgeL4={(transitionId) => acknowledgeMutation.mutate(transitionId)}
        acknowledging={acknowledgeMutation.isPending}
        toolbar={
          <div className="space-y-4">
            <div className="flex justify-end">
              <Btn asChild size="sm">
                <a href="/subjects/new">대상자 등록</a>
              </Btn>
            </div>
            <DashboardFilters search={search} onChange={updateSearch} />
          </div>
        }
      />
    </ShadeShell>
  );
}
