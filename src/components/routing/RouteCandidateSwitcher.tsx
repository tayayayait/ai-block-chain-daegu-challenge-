import { Check, Moon, Route } from "lucide-react";

import { summarizeRouteCandidate } from "./route-presentation";
import type { RouteCandidateUiDto } from "./route-ui-dto";

export function RouteCandidateSwitcher({
  candidates,
  selectedId,
  afterSunset,
  onSelect,
}: {
  candidates: readonly RouteCandidateUiDto[];
  selectedId: string;
  afterSunset: boolean;
  onSelect: (candidateId: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="경로 후보 선택">
      {candidates.map((candidate, index) => {
        const selected = candidate.id === selectedId;
        const summary = summarizeRouteCandidate(candidate);
        return (
          <button
            key={candidate.id}
            type="button"
            aria-label={`${candidate.label} 선택`}
            aria-pressed={selected}
            onClick={() => onSelect(candidate.id)}
            className={`relative min-h-[var(--tap-min)] rounded-xl border px-4 py-3 text-left transition-[border-color,background-color,transform] active:scale-[.99] ${
              selected
                ? "border-brand bg-[color-mix(in_oklab,var(--brand)_8%,var(--raised))] shadow-sh-1"
                : "border-border bg-raised hover:border-fg-3"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="t-body-s flex items-center gap-2 font-bold">
                {afterSunset ? (
                  <Moon aria-hidden="true" className="size-4 text-brand" />
                ) : (
                  <Route aria-hidden="true" className="size-4 text-brand" />
                )}
                {candidate.label}
              </span>
              {selected ? <Check aria-hidden="true" className="size-4 text-brand" /> : null}
            </span>
            <span className="t-caption mt-1 block text-fg-2">
              {summary.distanceLabel} · 도보 {summary.walkingMinutes}분
            </span>
            <span className="t-caption mt-1 block font-semibold text-brand">
              {afterSunset || summary.shadePercent === null
                ? index === 0
                  ? "최단 후보"
                  : "다른 후보"
                : `${summary.shadePercent}% 그늘`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
