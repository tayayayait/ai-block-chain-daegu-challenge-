import { AlertTriangle, Armchair, Footprints, Moon, SunMedium, Trees } from "lucide-react";

import { BottomSheet } from "@/components/onjung/Modal";

import { NaverMapLaunchNotice } from "./NaverMapLaunchNotice";
import { RouteCandidateSwitcher } from "./RouteCandidateSwitcher";
import {
  ACCESSIBILITY_CANDIDATE_NOTICE,
  formatRouteDistance,
  summarizeRouteCandidate,
  warningMessage,
} from "./route-presentation";
import type { RouteCandidateUiDto } from "./route-ui-dto";

function SegmentBar({ candidate }: { candidate: RouteCandidateUiDto }) {
  const total = candidate.segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.distanceM),
    0,
  );
  const shade = candidate.segments
    .filter((segment) => segment.exposure === "SHADE")
    .reduce((sum, segment) => sum + Math.max(0, segment.distanceM), 0);
  const sun = Math.max(0, total - shade);

  return (
    <div>
      <div
        role="img"
        aria-label={`경로 구간: 그늘 ${Math.round(shade)}m, 햇빛 ${Math.round(sun)}m`}
        className="flex h-4 overflow-hidden rounded-full bg-border"
      >
        {candidate.segments.map((segment) => (
          <span
            key={segment.id}
            aria-hidden="true"
            className={segment.exposure === "SHADE" ? "bg-heat-0" : "bg-heat-2"}
            style={{
              width: `${total === 0 ? 0 : (Math.max(0, segment.distanceM) / total) * 100}%`,
            }}
          />
        ))}
      </div>
      <div className="t-caption mt-2 flex justify-between text-fg-2" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-heat-0" />
          그늘
        </span>
        <span className="flex items-center gap-1.5">
          햇빛
          <span className="size-2 rounded-full bg-heat-2" />
        </span>
      </div>
    </div>
  );
}

export function RouteDetailSheet({
  candidate,
  candidates,
  afterSunset,
  naverMapUrl,
  onCandidateSelect,
  open,
  defaultOpen,
  onOpenChange,
}: {
  candidate: RouteCandidateUiDto;
  candidates: readonly RouteCandidateUiDto[];
  afterSunset: boolean;
  naverMapUrl: string | null;
  onCandidateSelect: (candidateId: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const summary = summarizeRouteCandidate(candidate);
  const spatialAnalysisUnavailable = !summary.spatialAnalysisAvailable;
  const title = `${candidate.label} · 도보 ${summary.walkingMinutes}분`;

  return (
    <BottomSheet
      title={title}
      description="0.75m/s 어르신 걸음 기준으로 계산한 시연 후보입니다."
      {...(open === undefined ? {} : { open })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      className="sm:left-1/2 sm:max-w-[640px] sm:-translate-x-1/2"
    >
      {afterSunset ? (
        <div
          className="t-body-s mb-4 flex items-center gap-2 rounded-lg border border-brand/30 bg-[color-mix(in_oklab,var(--brand)_8%,var(--raised))] px-4 py-3 font-bold"
          role="status"
        >
          <Moon aria-hidden="true" className="size-5 text-brand" />
          일몰 후 — 최단 경로로 안내합니다
        </div>
      ) : null}

      <RouteCandidateSwitcher
        candidates={candidates}
        selectedId={candidate.id}
        afterSunset={afterSunset}
        onSelect={onCandidateSelect}
      />

      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-[color-mix(in_oklab,var(--brand)_9%,transparent)] px-3 py-1 text-[13px] font-bold text-brand">
        {spatialAnalysisUnavailable ? (
          <Footprints aria-hidden="true" className="size-4" />
        ) : (
          <Trees aria-hidden="true" className="size-4" />
        )}
        {spatialAnalysisUnavailable ? "TMAP 보행 경로 후보" : "시연용 접근성 우선 후보"}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-background p-3">
          <dt className="t-caption flex items-center gap-1 text-fg-2">
            <Footprints aria-hidden="true" className="size-4" />
            거리
          </dt>
          <dd className="num mt-1 text-[18px] font-bold">{summary.distanceLabel}</dd>
        </div>
        <div className="rounded-lg bg-background p-3">
          <dt className="t-caption text-fg-2">어르신 걸음</dt>
          <dd className="num mt-1 text-[18px] font-bold">{summary.walkingMinutes}분</dd>
        </div>
        <div className="rounded-lg bg-background p-3">
          <dt className="t-caption flex items-center gap-1 text-fg-2">
            <Trees aria-hidden="true" className="size-4" />
            그늘
          </dt>
          <dd className="mt-1 text-[18px] font-bold">
            {spatialAnalysisUnavailable
              ? "자료 미확보"
              : afterSunset || summary.shadePercent === null
                ? "그늘 계산 생략"
                : `그늘 ${summary.shadePercent}%`}
          </dd>
        </div>
      </dl>

      {!afterSunset && !spatialAnalysisUnavailable ? (
        <div className="mt-5">
          <SegmentBar candidate={candidate} />
        </div>
      ) : null}

      {spatialAnalysisUnavailable ? (
        <section
          className="mt-5 rounded-lg border border-border bg-background p-4"
          aria-labelledby="spatial-analysis-unavailable"
        >
          <h3
            id="spatial-analysis-unavailable"
            className="t-body-s flex items-center gap-2 font-bold"
          >
            <AlertTriangle aria-hidden="true" className="size-5 text-heat-2" />
            공간자료 미확보
          </h3>
          <p className="t-body-s mt-2 text-fg-2">
            공간자료가 없어 그늘·장애물·휴식 지점 분석을 제공하지 않습니다.
          </p>
        </section>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <section className="rounded-lg border border-border p-4" aria-labelledby="sun-summary">
            <h3 id="sun-summary" className="t-body-s flex items-center gap-2 font-bold">
              <SunMedium aria-hidden="true" className="size-5 text-heat-2" />
              햇빛 구간
            </h3>
            <p className="t-body-s mt-2 text-fg-2">
              {summary.sunSegmentCount}곳 · 합계 {formatRouteDistance(summary.sunDistanceM)}
            </p>
          </section>
          <section className="rounded-lg border border-border p-4" aria-labelledby="rest-summary">
            <h3 id="rest-summary" className="t-body-s flex items-center gap-2 font-bold">
              <Armchair aria-hidden="true" className="size-5 text-brand" />
              확인된 휴식 지점
            </h3>
            {candidate.restSpots.length > 0 ? (
              <ul className="t-body-s mt-2 grid gap-1 text-fg-2">
                {candidate.restSpots.map((spot) => (
                  <li key={spot.id}>
                    {spot.label} · 출발 후 {formatRouteDistance(spot.distanceAlongRouteM)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-body-s mt-2 text-fg-2">확인된 휴식 지점이 없습니다.</p>
            )}
          </section>
        </div>
      )}

      {candidate.warnings.length > 0 ? (
        <section
          className="mt-4 rounded-lg border border-heat-2/40 bg-[color-mix(in_oklab,var(--heat-2)_7%,transparent)] p-4"
          aria-labelledby="route-uncertainty"
        >
          <h3 id="route-uncertainty" className="t-body-s flex items-center gap-2 font-bold">
            <AlertTriangle aria-hidden="true" className="size-5 text-heat-2" />
            확인이 필요한 항목
          </h3>
          <ul className="t-body-s mt-2 list-disc space-y-1 pl-5 text-fg-2">
            {[...new Set(candidate.warnings)].map((warning) => (
              <li key={warning}>{warningMessage(warning)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="t-body-s mt-4 rounded-lg bg-background p-4 text-fg-2">
        {ACCESSIBILITY_CANDIDATE_NOTICE}
      </p>

      <div className="mt-4">
        <NaverMapLaunchNotice url={naverMapUrl} />
      </div>
    </BottomSheet>
  );
}
