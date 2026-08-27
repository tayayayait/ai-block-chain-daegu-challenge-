import type { ReactNode } from "react";

import type { AsyncState as DashboardState } from "@/lib/domain-types";
import { createPublicError } from "@/lib/error-dto";
import { shortHash } from "@/lib/format";
import { LEVEL_ACTION } from "@/lib/risk/presentation";
import {
  AsyncState,
  EmptyState,
  ErrorState,
  PartialDataBanner,
} from "@/components/onjung/AsyncState";
import { AttestBadge, RiskBadge } from "@/components/onjung/Badges";
import { Btn } from "@/components/onjung/Btn";
import { IsothermRibbon } from "@/components/onjung/Ribbon";
import { RiskCard } from "@/components/onjung/RiskCard";
import { Card, SectionTitle } from "@/components/onjung/Shells";

import { formatDashboardUpdatedAt, newestUnreadL4Alert } from "./model";
import type { DashboardSnapshot } from "./types";

export interface DashboardViewProps {
  snapshot: DashboardSnapshot | null;
  state: DashboardState;
  onRetry: () => void;
  onAcknowledgeL4: (transitionId: string) => void;
  acknowledging: boolean;
  toolbar?: ReactNode;
}

function DashboardLoading() {
  return (
    <div className="space-y-4" data-testid="dashboard-loading">
      <div className="bg-overlay h-20 animate-pulse rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="bg-overlay h-32 animate-pulse rounded-lg" />
        ))}
      </div>
      <div className="bg-overlay h-72 animate-pulse rounded-lg" />
    </div>
  );
}

function DashboardEmpty({ filterHref }: { filterHref: string }) {
  return (
    <EmptyState
      title="현재 L3 이상 대상자가 없습니다"
      description="체감온도 31℃ 미만이면 위험도가 자동으로 낮아집니다"
      action={
        <Btn asChild variant="secondary">
          <a href={filterHref}>전체 명단 보기</a>
        </Btn>
      }
    />
  );
}

function DashboardError({ onRetry }: { onRetry: () => void }) {
  return <ErrorState error={createPublicError("SERVER_TEMPORARY")} onRetry={onRetry} />;
}

function L4AlertBar({
  snapshot,
  onAcknowledge,
  acknowledging,
}: {
  snapshot: DashboardSnapshot;
  onAcknowledge: (transitionId: string) => void;
  acknowledging: boolean;
}) {
  const alert = newestUnreadL4Alert(snapshot);
  if (!alert) return null;

  return (
    <div
      className="border-border fixed inset-x-0 top-16 flex items-center gap-3 border-b px-6 py-3"
      style={{ zIndex: "var(--z-alert-l4, 700)", backgroundColor: "var(--heat-4)", color: "#fff" }}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <strong className="t-body-s min-w-0 break-words">
        L4 위험 신규 발생 — {alert.maskedName} · {alert.age}세 (HRI {alert.hri})
      </strong>
      <span className="t-caption hidden opacity-90 xl:inline">{LEVEL_ACTION.L4}</span>
      <Btn
        type="button"
        size="sm"
        variant="ghost"
        className="ml-auto shrink-0 text-white"
        loading={acknowledging}
        onClick={() => onAcknowledge(alert.transitionId)}
        aria-label="L4 신규 경보 확인"
      >
        확인
      </Btn>
    </div>
  );
}

function SummaryCards({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-3" aria-label="위험도 요약">
      {(["L4", "L3", "L2"] as const).map((level) => (
        <Card key={level}>
          <RiskBadge level={level} />
          <p
            className="t-data-l num mt-3"
            data-level={level}
            style={{ color: `var(--heat-${level.slice(1)})` }}
          >
            {snapshot.summary.byLevel[level]}
          </p>
          <p className="t-caption text-fg-2 mt-1">{LEVEL_ACTION[level]}</p>
        </Card>
      ))}
    </div>
  );
}

function UrgentSubjects({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <section className="mt-12" aria-labelledby="urgent-subjects-heading">
      <SectionTitle
        action={
          <a
            href={`/dashboard?gu=${encodeURIComponent(snapshot.filter.gu)}&level=L2&sort=${snapshot.filter.sort}&order=${snapshot.filter.order}`}
            className="t-body-s"
            style={{ color: "var(--brand)" }}
          >
            전체 명단 →
          </a>
        }
      >
        <span id="urgent-subjects-heading">즉시 조치 필요</span>
      </SectionTitle>

      <ul className="space-y-4">
        {snapshot.urgentSubjects.map((subject) => (
          <li key={subject.id}>
            <RiskCard
              level={subject.level}
              score={subject.hri}
              subject={{
                maskedName: subject.maskedName,
                age: subject.age,
                livesAlone: subject.livesAlone,
              }}
              feelsLikeC={subject.feelsLikeC}
              location={subject.locationLabel}
              reasons={subject.reasons}
              action={
                <div className="flex flex-wrap gap-2">
                  <Btn asChild size="sm" variant="secondary">
                    <a href={`/shelters?subjectId=${encodeURIComponent(subject.id)}`}>
                      쉼터 경로 발송
                    </a>
                  </Btn>
                  <Btn asChild size="sm" variant="ghost">
                    <a href={`/subjects/${encodeURIComponent(subject.id)}`}>{subject.maskedName}</a>
                  </Btn>
                </div>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MapPreparation({ snapshot }: { snapshot: DashboardSnapshot }) {
  const rows = snapshot.mapSubjects.length > 0 ? snapshot.mapSubjects : snapshot.urgentSubjects;

  return (
    <div className="border-border bg-overlay rounded-lg border p-5">
      <div role="status" aria-label="지도 준비 상태" className="t-body-s">
        <strong>Naver 지도 연결 준비 중</strong>
        <p className="text-fg-2 mt-1 break-words">
          지도 SDK 연결 전에도 아래 목록으로 동일한 위험 대상 정보를 확인할 수 있습니다.
        </p>
      </div>
      <ul aria-label="지도 대체 위험 대상자 목록" className="divide-border mt-4 divide-y">
        {rows.map((subject) => (
          <li key={subject.id} className="flex min-w-0 items-center gap-3 py-3">
            <RiskBadge level={subject.level} />
            <span className="t-body-s min-w-0 flex-1 truncate">
              {subject.maskedName} · {subject.locationLabel}
            </span>
            <span className="t-data-s num shrink-0" aria-label={`HRI ${subject.hri}점`}>
              {subject.hri}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CareEventFeed({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <ul className="divide-border divide-y">
      {snapshot.careEvents.length === 0 ? (
        <li className="text-fg-2 t-body-s py-6">최근 온체인 기록이 없습니다.</li>
      ) : (
        snapshot.careEvents.slice(0, 10).map((event) => (
          <li key={event.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="t-body-s truncate">
                {formatDashboardUpdatedAt(event.occurredAt)} · {event.typeLabel}
              </p>
              <p className="t-data-s text-fg-3" translate="no">
                {event.attestationUid
                  ? shortHash(event.attestationUid)
                  : event.attest === "PENDING"
                    ? "증명 UID 발급 대기"
                    : "온체인 증명 UID 없음"}
              </p>
            </div>
            <AttestBadge state={event.attest} uid={event.attestationUid ?? undefined} />
          </li>
        ))
      )}
    </ul>
  );
}

function DashboardData({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <>
      <div className="mt-6">
        <IsothermRibbon score={snapshot.summary.averageHri} showLabels />
      </div>
      <SummaryCards snapshot={snapshot} />
      <UrgentSubjects snapshot={snapshot} />

      <div className="mt-12 grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <SectionTitle>위험도 지도</SectionTitle>
          <MapPreparation snapshot={snapshot} />
        </Card>
        <Card className="lg:col-span-5">
          <SectionTitle>최근 온체인 기록</SectionTitle>
          <p className="t-caption text-fg-3 -mt-1 mb-2">Base Sepolia 테스트넷</p>
          <CareEventFeed snapshot={snapshot} />
        </Card>
      </div>
    </>
  );
}

export function DashboardView({
  snapshot,
  state,
  onRetry,
  onAcknowledgeL4,
  acknowledging,
  toolbar,
}: DashboardViewProps) {
  const updatedAt = snapshot ? formatDashboardUpdatedAt(snapshot.fetchedAt) : null;
  const missingSources = snapshot?.missingSources ?? [];
  const filterHref = snapshot
    ? `/dashboard?gu=${encodeURIComponent(snapshot.filter.gu)}&level=L2&sort=${snapshot.filter.sort}&order=${snapshot.filter.order}`
    : "/dashboard?gu=전체&level=L2&sort=hri&order=desc";

  return (
    <>
      {snapshot ? (
        <L4AlertBar
          snapshot={snapshot}
          onAcknowledge={onAcknowledgeL4}
          acknowledging={acknowledging}
        />
      ) : null}

      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="t-h1">관제 대시보드</h1>
          <p className="text-fg-2 t-body-s mt-1 break-words">
            {snapshot
              ? `대상자 ${snapshot.summary.total}명 · 관할 평균 HRI ${snapshot.summary.averageHri}`
              : "담당 조직의 폭염 위험 현황"}
          </p>
          {snapshot?.source === "DEMO_FIXTURE" ? (
            <p className="text-fg-3 t-caption mt-1">안전한 데모 데이터 어댑터 사용 중</p>
          ) : null}
        </div>
        {updatedAt ? <p className="text-fg-3 t-caption shrink-0">마지막 갱신 {updatedAt}</p> : null}
      </header>

      {toolbar ? <div className="mt-6">{toolbar}</div> : null}

      <AsyncState
        state={state}
        ariaLabel="관제 대시보드 데이터"
        className="mt-6"
        loadingFallback={<DashboardLoading />}
        emptyFallback={<DashboardEmpty filterHref={filterHref} />}
        errorFallback={<DashboardError onRetry={onRetry} />}
        partialBanner={
          missingSources.length > 0 && updatedAt ? (
            <PartialDataBanner
              missingSources={missingSources as [string, ...string[]]}
              lastSuccessfulAtLabel={updatedAt}
              className="mb-4"
            />
          ) : null
        }
      >
        {snapshot ? <DashboardData snapshot={snapshot} /> : null}
      </AsyncState>
    </>
  );
}
