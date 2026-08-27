import { useState } from "react";

import { AttestBadge, RiskBadge } from "@/components/onjung/Badges";
import { Btn } from "@/components/onjung/Btn";
import { IsothermRibbon } from "@/components/onjung/Ribbon";
import { createPublicError, type PublicErrorDto } from "@/lib/error-dto";
import type { FullSubjectPiiDto } from "@/lib/subjects/dto";

import {
  SUBJECT_DETAIL_FEATURES_PENDING,
  type FeatureLinkReadiness,
  type SubjectCareEventDto,
  type SubjectDetailDto,
  type SubjectDetailFeatureReadiness,
  type SubjectMedicationDto,
  type SubjectPiiRevealResult,
} from "./types";

const SEX_LABEL = {
  FEMALE: "여",
  MALE: "남",
  OTHER: "기타",
  UNDISCLOSED: "미공개",
} as const;

const MED_SOURCE_LABEL = {
  AI_AUTO: "자동 인식",
  AI_CONFIRMED: "확인 완료",
  MANUAL: "직접 입력",
} as const;

const MED_TIER_LABEL = {
  HIGH: "고위험 +6",
  MID: "중위험 +3",
  NONE: "추가 위험 없음",
} as const;

const CARE_EVENT_LABEL = {
  VISIT: "돌봄 방문",
  SHELTER_CHECKIN: "쉼터 체크인",
  ALERT_SENT: "보호자 알림",
} as const;

const RISK_BREAKDOWN = [
  { key: "E", label: "환경", maximum: 50, subtract: false },
  { key: "M", label: "복약", maximum: 25, subtract: false },
  { key: "P", label: "개인", maximum: 20, subtract: false },
  { key: "C", label: "완화", maximum: 6, subtract: true },
] as const;

type SubjectDetailViewProps = Readonly<{
  detail: SubjectDetailDto;
  requestFullPii?: () => Promise<SubjectPiiRevealResult>;
  features?: SubjectDetailFeatureReadiness;
}>;

function formatKoreanDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function FeatureAction({
  readiness,
  readyLabel,
  pendingLabel,
  variant = "secondary",
}: {
  readiness: FeatureLinkReadiness;
  readyLabel: string;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  if (readiness.ready) {
    return (
      <Btn asChild variant={variant} size="lg" full>
        <a href={readiness.href}>{readyLabel}</a>
      </Btn>
    );
  }

  return (
    <Btn type="button" variant={variant} size="lg" full disabled aria-label={pendingLabel}>
      {pendingLabel}
    </Btn>
  );
}

function PiiSummary({
  detail,
  fullPii,
}: {
  detail: SubjectDetailDto;
  fullPii: FullSubjectPiiDto | null;
}) {
  return (
    <dl className="text-fg-2 t-body-s mt-3 grid gap-2 sm:grid-cols-2">
      <div>
        <dt className="sr-only">주소</dt>
        <dd>{fullPii?.address ?? detail.subject.shortAddress}</dd>
      </div>
      <div>
        <dt className="sr-only">연락처</dt>
        <dd>{fullPii?.phone || detail.subject.maskedPhone}</dd>
      </div>
    </dl>
  );
}

function RiskBreakdown({ detail }: { detail: SubjectDetailDto }) {
  const risk = detail.latestRisk;
  if (!risk) {
    return (
      <section
        className="border-border bg-raised rounded-lg border p-5"
        aria-labelledby="risk-breakdown-title"
      >
        <h2 id="risk-breakdown-title" className="t-h3">
          위험도 구성
        </h2>
        <div className="mt-4 rounded-md border border-dashed p-4" role="status">
          <p className="t-body-s font-semibold">첫 위험도 계산을 기다리고 있습니다.</p>
          <p className="text-fg-2 t-caption mt-1">
            최신 기상 데이터가 수집되면 위험도가 자동으로 계산됩니다.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="border-border bg-raised rounded-lg border p-5"
      aria-labelledby="risk-breakdown-title"
      aria-label="위험도 구성"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="risk-breakdown-title" className="t-h3">
          위험도 구성
        </h2>
        <span className="text-fg-3 t-caption">{formatKoreanDateTime(risk.computedAt)} 계산</span>
      </div>

      <div className="mt-5 space-y-4">
        {RISK_BREAKDOWN.map(({ key, label, maximum, subtract }) => {
          const value = risk.breakdown[key];
          const percentage = Math.round((value / maximum) * 100);
          return (
            <div key={key} className="grid grid-cols-[72px_1fr_56px] items-center gap-3">
              <span className="t-body-s font-semibold">
                {label} <span className="num">{key}</span>
              </span>
              <div className="bg-overlay h-3 overflow-hidden rounded-full">
                <div
                  role="progressbar"
                  aria-label={`${label} 점수 ${value}점 / 최대 ${maximum}점`}
                  aria-valuemin={0}
                  aria-valuemax={maximum}
                  aria-valuenow={value}
                  className="h-full rounded-full"
                  style={{
                    width: `${percentage}%`,
                    backgroundColor: subtract ? "var(--attest)" : "var(--brand)",
                  }}
                />
              </div>
              <strong className="num t-body-s text-right">
                {subtract && value > 0 ? "−" : ""}
                {value}
              </strong>
            </div>
          );
        })}
      </div>

      <div className="border-border mt-5 flex flex-wrap items-baseline justify-between gap-2 border-t pt-4">
        <span className="t-body-s font-semibold">실제 합계</span>
        <span className="num t-body-s" aria-label={`HRI 실제 합계 ${risk.score}점`}>
          {risk.breakdown.E} + {risk.breakdown.M} + {risk.breakdown.P} − {risk.breakdown.C} ={" "}
          {risk.score}
        </span>
      </div>
    </section>
  );
}

function MedicationItem({ medication }: { medication: SubjectMedicationDto }) {
  return (
    <li className="border-border flex flex-col gap-2 border-b py-4 last:border-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="t-body-s font-semibold">{medication.productName}</p>
        <p className="text-fg-2 t-caption mt-1">
          {medication.heatClass ?? "열위험 계열 없음"} · {MED_TIER_LABEL[medication.riskTier]}
        </p>
      </div>
      <span className="t-caption border-border w-fit rounded-full border px-2.5 py-1 font-semibold">
        {MED_SOURCE_LABEL[medication.source]}
      </span>
    </li>
  );
}

function MedicationSection({
  detail,
  readiness,
}: {
  detail: SubjectDetailDto;
  readiness: FeatureLinkReadiness;
}) {
  const pendingLabel =
    detail.medications.length === 0 && detail.subject.medicationRegistered
      ? "복약 정보 추가를 현재 사용할 수 없습니다"
      : "약봉투 촬영을 현재 사용할 수 없습니다";

  return (
    <section className="border-border bg-raised rounded-lg border p-5" aria-labelledby="med-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="med-title" className="t-h3">
          복약 정보 <span className="num t-caption">{detail.medications.length}건</span>
        </h2>
        <div className="min-w-[240px]">
          <FeatureAction
            readiness={readiness}
            readyLabel="약봉투 촬영"
            pendingLabel={pendingLabel}
          />
        </div>
      </div>

      {detail.medications.length > 0 ? (
        <ul className="mt-3">
          {detail.medications.map((medication) => (
            <MedicationItem key={medication.id} medication={medication} />
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-md border border-dashed p-4">
          <p className="t-body-s font-semibold">
            {detail.subject.medicationRegistered
              ? "현재 복약 이력이 없습니다."
              : "복약 정보가 등록되지 않았습니다."}
          </p>
          <p className="text-fg-2 t-caption mt-1">
            {readiness.ready
              ? "약봉투 촬영 또는 직접 입력으로 복약 정보를 등록할 수 있습니다."
              : "현재 복약 정보 등록 기능을 사용할 수 없습니다."}
          </p>
        </div>
      )}
    </section>
  );
}

function CareEventItem({
  event,
  verification,
}: {
  event: SubjectCareEventDto;
  verification: FeatureLinkReadiness;
}) {
  return (
    <li className="border-border flex flex-wrap items-center gap-3 border-b py-4 last:border-0">
      <span className="t-caption num text-fg-3">{formatKoreanDateTime(event.occurredAt)}</span>
      <span className="t-body-s font-semibold">{CARE_EVENT_LABEL[event.type]}</span>
      <span className="num t-caption">
        {event.riskLevel} · HRI {event.hri}
      </span>
      <span className="ml-auto">
        <AttestBadge
          state={event.attestationState}
          uid={verification.ready ? (event.attestationUid ?? undefined) : undefined}
        />
      </span>
    </li>
  );
}

export function SubjectDetailView({
  detail,
  requestFullPii,
  features = SUBJECT_DETAIL_FEATURES_PENDING,
}: SubjectDetailViewProps) {
  const [fullPii, setFullPii] = useState<FullSubjectPiiDto | null>(null);
  const [revealError, setRevealError] = useState<PublicErrorDto | null>(null);
  const [revealing, setRevealing] = useState(false);
  const risk = detail.latestRisk;

  const togglePii = async () => {
    if (fullPii) {
      setFullPii(null);
      setRevealError(null);
      return;
    }
    if (!requestFullPii || revealing) return;

    setRevealing(true);
    setRevealError(null);
    try {
      const result = await requestFullPii();
      if (result.kind === "success" && result.data.id === detail.subject.id) {
        setFullPii(result.data);
      } else if (result.kind === "success") {
        setRevealError(createPublicError("INTERNAL_ERROR"));
      } else if (result.kind === "error") {
        setRevealError(result.error);
      }
    } catch {
      setRevealError(createPublicError("NETWORK_UNAVAILABLE"));
    } finally {
      setRevealing(false);
    }
  };

  return (
    <div
      className={`shade bg-background text-foreground min-h-dvh ${detail.subject.seniorMode ? "senior" : ""}`}
      data-senior={String(detail.subject.seniorMode)}
    >
      <div className="mx-auto w-full max-w-[1120px] px-4 pt-5 pb-32 sm:px-6 lg:px-8">
        <a
          href="/dashboard"
          className="text-fg-2 t-body-s inline-flex min-h-[var(--tap-min)] items-center"
        >
          ← 명단으로
        </a>

        <header className="mt-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="t-h1">{fullPii?.name ?? detail.subject.maskedName}</h1>
                {risk && <RiskBadge level={risk.level} />}
              </div>
              <p className="text-fg-2 t-body-s mt-2">
                <span className="num">{detail.subject.age}</span>세 ·{" "}
                {SEX_LABEL[detail.subject.sex]}
                {detail.subject.livesAlone ? " · 독거" : ""}
              </p>
            </div>

            {requestFullPii && (
              <Btn type="button" variant="ghost" size="md" loading={revealing} onClick={togglePii}>
                {fullPii ? "개인정보 가리기" : "전체 개인정보 보기"}
              </Btn>
            )}
          </div>

          <PiiSummary detail={detail} fullPii={fullPii} />
          {revealError && (
            <p className="t-caption mt-3" style={{ color: "var(--danger)" }} role="alert">
              {revealError.userMessage}
            </p>
          )}

          {risk ? (
            <IsothermRibbon score={risk.score} variant="full" showLabels className="mt-6" />
          ) : (
            <p className="text-fg-2 t-caption mt-6" role="status">
              위험도 계산 대기 중
            </p>
          )}
        </header>

        <div className="mt-8 grid gap-6">
          <RiskBreakdown detail={detail} />
          <MedicationSection detail={detail} readiness={features.medicationCapture} />

          <section
            className="border-border bg-raised rounded-lg border p-5"
            aria-labelledby="care-events-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="care-events-title" className="t-h3">
                돌봄 이력 (온체인)
              </h2>
              <span className="t-caption text-fg-3">Base Sepolia 테스트넷</span>
            </div>
            {detail.careEvents.length > 0 ? (
              <ul className="mt-3">
                {detail.careEvents.map((event) => (
                  <CareEventItem
                    key={event.id}
                    event={event}
                    verification={features.attestationVerification}
                  />
                ))}
              </ul>
            ) : (
              <div className="mt-4 rounded-md border border-dashed p-4">
                <p className="t-body-s font-semibold">아직 기록된 돌봄 이력이 없습니다.</p>
                <p className="text-fg-2 t-caption mt-1">
                  검증 가능한 돌봄 이벤트가 생성되면 이곳에 표시됩니다.
                </p>
              </div>
            )}
            {!features.attestationVerification.ready && detail.careEvents.length > 0 && (
              <p className="text-fg-3 t-caption mt-3">
                온체인 증명 상세를 현재 확인할 수 없습니다.
              </p>
            )}
          </section>
        </div>
      </div>

      <div className="border-border bg-raised fixed inset-x-0 bottom-0 border-t p-3 sm:static sm:mx-auto sm:max-w-[1120px] sm:border-0 sm:bg-transparent sm:px-8">
        <div className="grid grid-cols-2 gap-3">
          <FeatureAction
            readiness={features.shelterRouting}
            readyLabel="쉼터 경로 발송"
            pendingLabel="쉼터 경로 발송을 현재 사용할 수 없습니다"
            variant="primary"
          />
          <FeatureAction
            readiness={features.guardianAlert}
            readyLabel="보호자 알림"
            pendingLabel="보호자 알림이 현재 비활성화되어 있습니다"
            variant="secondary"
          />
        </div>
      </div>
    </div>
  );
}
