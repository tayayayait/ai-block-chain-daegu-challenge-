import type { ReactNode } from "react";

import {
  AsyncState,
  EmptyState,
  ErrorState,
  PartialDataBanner,
} from "@/components/onjung/AsyncState";
import { RiskBadge } from "@/components/onjung/Badges";
import { Btn } from "@/components/onjung/Btn";
import { DataTable, type DataTableColumn } from "@/components/onjung/DataTable";
import { FormField } from "@/components/onjung/FormField";
import { MapFallbackList } from "@/components/onjung/MapFallbackList";
import { BottomSheet, Modal } from "@/components/onjung/Modal";
import { RiskCard } from "@/components/onjung/RiskCard";
import { ShelterCard } from "@/components/onjung/ShelterCard";
import { ToastViewport } from "@/components/onjung/Toast";
import { ASYNC_STATES, RISK_LEVELS, type AsyncState as AsyncStatus } from "@/lib/domain-types";
import { createPublicError } from "@/lib/error-dto";

import {
  DEMO_RISK_CASES,
  DEMO_SHELTERS,
  DEMO_TABLE_ROWS,
  DEMO_TOASTS,
  type DemoTableRow,
} from "./components-data";

type Surface = "paper" | "shade";

const TABLE_COLUMNS: readonly DataTableColumn<DemoTableRow>[] = [
  { id: "name", label: "가상 대상", render: (row) => row.maskedName, sortKey: "name" },
  { id: "level", label: "등급", render: (row) => row.level, sortKey: "level" },
  {
    id: "score",
    label: "HRI",
    render: (row) => row.score,
    numeric: true,
    sortKey: "score",
  },
];

const noop = () => undefined;

function DemoBlock({
  component,
  title,
  children,
}: {
  component: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={`demo-component-${component}`} className="border-border border-t pt-8">
      <h3 className="t-h2">{title}</h3>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function LoadingSample() {
  return (
    <div className="bg-overlay h-24 animate-pulse rounded-lg" aria-label="가상 로딩 자리표시자" />
  );
}

function DemoEmptyState() {
  return (
    <EmptyState
      title="가상 결과가 없습니다"
      description="조건을 바꾸면 다른 가상 상태를 확인할 수 있습니다."
      action={
        <Btn type="button" variant="secondary" size="sm">
          조건 초기화
        </Btn>
      }
    />
  );
}

function DemoAsyncState({ state, surface }: { state: AsyncStatus; surface: Surface }) {
  return (
    <div data-testid={`demo-async-${state}`} className="border-border rounded-lg border p-3">
      <p className="t-caption text-fg-2 mb-2">{state}</p>
      <AsyncState
        state={state}
        ariaLabel={`${surface} ${state} 가상 비동기 상태`}
        loadingFallback={<LoadingSample />}
        emptyFallback={<DemoEmptyState />}
        errorFallback={
          <ErrorState error={createPublicError("NETWORK_UNAVAILABLE")} onRetry={noop} />
        }
        partialBanner={
          <PartialDataBanner missingSources={["가상 기상"]} lastSuccessfulAtLabel="14:00" />
        }
      >
        <p className="t-body-s bg-raised rounded-md p-3">가상 데이터가 표시되는 영역입니다.</p>
      </AsyncState>
    </div>
  );
}

function ButtonGallery() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Btn type="button" variant="primary">
          기본
        </Btn>
        <Btn type="button" variant="secondary">
          보조
        </Btn>
        <Btn type="button" variant="ghost">
          고스트
        </Btn>
        <Btn type="button" variant="danger">
          위험
        </Btn>
        <Btn type="button" variant="attest">
          증명
        </Btn>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Btn type="button" size="sm">
          sm
        </Btn>
        <Btn type="button" size="md">
          md
        </Btn>
        <Btn type="button" size="lg">
          lg
        </Btn>
        <Btn type="button" size="xl">
          xl
        </Btn>
        <Btn type="button" size="senior">
          시니어
        </Btn>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Btn type="button" loading>
          처리 중
        </Btn>
        <Btn type="button" disabled>
          비활성
        </Btn>
        <Btn asChild variant="secondary">
          <a href="#demo-data-table">링크 버튼</a>
        </Btn>
      </div>
    </div>
  );
}

function DialogGallery({ surface }: { surface: Surface }) {
  if (surface === "shade") {
    return (
      <Modal
        title="Shade 모달"
        description="가상 데스크톱 모달의 포커스·닫기 동작을 확인합니다."
        trigger={<Btn type="button">Shade 모달 열기</Btn>}
      >
        <FormField label="가상 확인 메모" placeholder="메모 입력" surface="shade" />
      </Modal>
    );
  }

  return (
    <BottomSheet
      title="Paper 바텀시트"
      description="가상 모바일 바텀시트의 safe-area와 포커스를 확인합니다."
      trigger={<Btn type="button">Paper 바텀시트 열기</Btn>}
    >
      <FormField label="가상 확인 메모" placeholder="메모 입력" surface="paper" />
    </BottomSheet>
  );
}

function SurfaceShowcase({ surface }: { surface: Surface }) {
  return (
    <div className="space-y-12">
      <DemoBlock component="RiskBadge" title="RiskBadge — L0부터 L4">
        <div className="flex flex-wrap gap-3">
          {RISK_LEVELS.map((level) => (
            <span key={level} data-testid={`demo-risk-${level}`}>
              <RiskBadge level={level} />
            </span>
          ))}
        </div>
      </DemoBlock>

      <DemoBlock component="Btn" title="Btn — variant, size, loading, disabled, link">
        <ButtonGallery />
      </DemoBlock>

      <DemoBlock component="AsyncState" title="AsyncState — 모든 상태">
        <div className="grid gap-4 lg:grid-cols-2">
          {ASYNC_STATES.map((state) => (
            <DemoAsyncState key={state} state={state} surface={surface} />
          ))}
        </div>
      </DemoBlock>

      <DemoBlock component="RiskCard" title="RiskCard — 모든 위험 등급">
        <div className="grid gap-4 lg:grid-cols-2">
          {DEMO_RISK_CASES.map((riskCase) => (
            <RiskCard
              key={riskCase.level}
              {...riskCase}
              surface={surface}
              action={
                <Btn type="button" size="sm" variant="secondary">
                  가상 조치 확인
                </Btn>
              }
            />
          ))}
        </div>
      </DemoBlock>

      <DemoBlock component="ShelterCard" title="ShelterCard — 운영·증명 상태">
        <div className="grid gap-4 lg:grid-cols-2">
          {DEMO_SHELTERS.map((shelter) => (
            <ShelterCard
              key={shelter.id}
              shelter={shelter}
              surface={surface}
              action={
                <Btn type="button" size="sm" variant="secondary">
                  가상 경로 확인
                </Btn>
              }
            />
          ))}
        </div>
      </DemoBlock>

      <DemoBlock component="FormField" title="FormField — 기본, 오류, 비활성, 검색">
        <div className="grid gap-5 lg:grid-cols-2">
          <FormField
            id={`demo-${surface}-normal`}
            label="가상 이름"
            placeholder="이름 입력"
            surface={surface}
          />
          <FormField
            id={`demo-${surface}-error`}
            label="가상 인증 코드"
            kind="code"
            defaultValue="12"
            error="가상 코드는 4자리여야 합니다."
            surface={surface}
          />
          <FormField
            id={`demo-${surface}-disabled`}
            label="비활성 필드"
            defaultValue="가상 비활성 값"
            disabled
            surface={surface}
          />
          <FormField
            id={`demo-${surface}-search`}
            label="가상 검색"
            kind="search"
            placeholder="쉼터 검색"
            hint="실제 위치나 개인정보는 사용하지 않습니다."
            surface={surface}
          />
        </div>
      </DemoBlock>

      <DemoBlock
        component={surface === "shade" ? "Modal" : "BottomSheet"}
        title={surface === "shade" ? "Modal" : "BottomSheet"}
      >
        <DialogGallery surface={surface} />
      </DemoBlock>

      <DemoBlock component="Toast" title="Toast — success, info, error">
        <div
          className="border-border bg-background relative isolate h-[360px] overflow-hidden rounded-lg border"
          style={{ transform: "translateZ(0)" }}
        >
          <ToastViewport toasts={DEMO_TOASTS} onDismiss={noop} surface={surface} />
        </div>
      </DemoBlock>

      <DemoBlock component="DataTable" title="DataTable — 가상화 및 빈 상태">
        <div id="demo-data-table" className="space-y-5">
          <DataTable
            caption={`${surface} 가상 대상자 표`}
            columns={TABLE_COLUMNS}
            rows={DEMO_TABLE_ROWS}
            getRowKey={(row) => row.id}
            getRowHref={(row) => `#${row.id}`}
            getRowLabel={(row) => `${row.maskedName} 가상 상세 보기`}
            sort={{ key: "score", order: "desc" }}
            sortBaseHref="/dev/components?demo=table"
          />
          <DataTable
            caption={`${surface} 빈 가상 대상자 표`}
            columns={TABLE_COLUMNS}
            rows={[]}
            getRowKey={(row) => row.id}
            getRowHref={(row) => `#${row.id}`}
            getRowLabel={(row) => `${row.maskedName} 가상 상세 보기`}
            emptyMessage="가상 결과가 없습니다."
          />
        </div>
      </DemoBlock>

      <DemoBlock component="MapFallbackList" title="MapFallbackList — 목록 및 빈 상태">
        <div className="space-y-10">
          <MapFallbackList
            shelters={DEMO_SHELTERS}
            getRouteHref={(shelter) => `#route-${shelter.id}`}
            surface={surface}
            title="가상 쉼터 목록"
          />
          <MapFallbackList
            shelters={[]}
            getRouteHref={(shelter) => `#route-${shelter.id}`}
            surface={surface}
            title="가상 빈 쉼터 목록"
          />
        </div>
      </DemoBlock>
    </div>
  );
}

function PreviewFrame({
  surface,
  viewportWidth,
  testId,
  children,
}: {
  surface: Surface;
  viewportWidth: "360px" | "1024px";
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="w-full overflow-x-auto pb-3">
      <section
        data-testid={testId}
        data-surface={surface}
        data-viewport-width={viewportWidth}
        aria-label={`${surface === "paper" ? "Paper" : "Shade"} ${viewportWidth} 미리보기`}
        className={`${surface} bg-background text-foreground mx-auto rounded-xl p-4 sm:p-6`}
        style={{ width: viewportWidth, maxWidth: surface === "paper" ? "100%" : undefined }}
      >
        <header className="mb-10">
          <p className="t-caption text-fg-2">
            {surface.toUpperCase()} · {viewportWidth}
          </p>
          <h2 className="t-h1 mt-2">
            {surface === "paper" ? "생활지원사 모바일" : "관제 데스크톱"}
          </h2>
        </header>
        {children}
      </section>
    </div>
  );
}

export function DevComponentsGallery() {
  return (
    <main
      data-testid="dev-components-gallery"
      aria-labelledby="dev-components-title"
      className="bg-background text-foreground min-h-screen px-4 py-10 sm:px-8"
    >
      <header className="mx-auto mb-12 max-w-5xl">
        <p className="t-caption text-fg-2">DEV ONLY · 가상 데이터</p>
        <h1 id="dev-components-title" className="t-display mt-2">
          온중 공통 컴포넌트 갤러리
        </h1>
        <p className="t-body-s text-fg-2 mt-3 max-w-3xl">
          Paper 360px와 Shade 1024px에서 공통 컴포넌트의 상태·surface·키보드 동작을 검토합니다. 이
          화면의 이름, 위치, 기록은 모두 가상 값입니다.
        </p>
      </header>

      <div className="mx-auto space-y-16">
        <PreviewFrame surface="paper" viewportWidth="360px" testId="paper-360-preview">
          <SurfaceShowcase surface="paper" />
        </PreviewFrame>

        <PreviewFrame surface="shade" viewportWidth="1024px" testId="shade-1024-preview">
          <SurfaceShowcase surface="shade" />
        </PreviewFrame>
      </div>
    </main>
  );
}
