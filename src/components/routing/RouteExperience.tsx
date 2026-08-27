import { Info, Moon, PanelBottomOpen } from "lucide-react";
import { useState } from "react";

import { Btn } from "@/components/onjung/Btn";

import { NaverRouteMap } from "./NaverRouteMap";
import { RouteCandidateSwitcher } from "./RouteCandidateSwitcher";
import { RouteDetailSheet } from "./RouteDetailSheet";
import type { NaverRouteMapsLoaderPort, RoutePlanUiDto } from "./route-ui-dto";

export function RouteExperience({
  plan,
  initialCandidateId,
  mapLoader,
  defaultDetailOpen = false,
  onCandidateChange,
}: {
  plan: RoutePlanUiDto;
  initialCandidateId?: string;
  mapLoader?: NaverRouteMapsLoaderPort;
  defaultDetailOpen?: boolean;
  onCandidateChange?: (candidateId: string) => void;
}) {
  const initial =
    plan.candidates.find((candidate) => candidate.id === initialCandidateId) ?? plan.candidates[0];
  const [selectedId, setSelectedId] = useState(initial?.id ?? "");
  const [detailOpen, setDetailOpen] = useState(defaultDetailOpen);
  const selected =
    plan.candidates.find((candidate) => candidate.id === selectedId) ?? plan.candidates[0];

  if (!selected) {
    return (
      <section aria-label="경로 안내" className="rounded-xl border border-border bg-raised p-6">
        <p className="t-body-s font-semibold" role="status">
          표시할 수 있는 경로 후보가 없습니다.
        </p>
        <p className="t-caption mt-1 text-fg-2">출발 위치를 확인한 뒤 다시 요청해 주세요.</p>
      </section>
    );
  }

  const selectCandidate = (candidateId: string) => {
    setSelectedId(candidateId);
    onCandidateChange?.(candidateId);
  };

  return (
    <section aria-labelledby="route-heading" className="space-y-4">
      <header>
        <p className="t-caption font-bold text-brand">{plan.destinationName}</p>
        <h2 id="route-heading" className="t-h2 mt-1">
          보행 경로 후보
        </h2>
      </header>

      {plan.afterSunset ? (
        <div
          className="t-body-s flex items-center gap-2 rounded-lg border border-brand/30 bg-[color-mix(in_oklab,var(--brand)_8%,var(--raised))] px-4 py-3 font-bold"
          role="status"
        >
          <Moon aria-hidden="true" className="size-5 text-brand" />
          일몰 후 — 최단 경로로 안내합니다
        </div>
      ) : null}

      <RouteCandidateSwitcher
        candidates={plan.candidates}
        selectedId={selected.id}
        afterSunset={plan.afterSunset}
        onSelect={selectCandidate}
      />

      <NaverRouteMap
        selected={selected}
        alternatives={plan.candidates.filter((candidate) => candidate.id !== selected.id)}
        afterSunset={plan.afterSunset}
        shadowCalculatedAt={plan.shadowCalculatedAt}
        {...(mapLoader === undefined ? {} : { loader: mapLoader })}
      />

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-raised p-4 shadow-sh-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="t-caption flex items-start gap-2 text-fg-2">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
          경로 상세에서 햇빛 구간, 확인된 휴식 지점과 자료의 불확실성을 함께 확인하세요.
        </p>
        <Btn type="button" variant="secondary" onClick={() => setDetailOpen(true)}>
          <PanelBottomOpen aria-hidden="true" className="size-5" />
          경로 상세 보기
        </Btn>
      </div>

      <RouteDetailSheet
        candidate={selected}
        candidates={plan.candidates}
        afterSunset={plan.afterSunset}
        naverMapUrl={plan.naverMapUrl}
        onCandidateSelect={selectCandidate}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </section>
  );
}
