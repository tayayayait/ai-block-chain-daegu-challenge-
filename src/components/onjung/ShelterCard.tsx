import type { ReactNode } from "react";

import type { AttestState, CrowdLevel, ShelterOpen } from "@/lib/domain-types";

import { AttestBadge } from "./Badges";

export interface ShelterCardData {
  id: string;
  name: string;
  gu: string;
  facilityType: string;
  isImBank: boolean;
  roadAddress?: string;
  distanceM: number;
  walkMin: number;
  shadeRatio?: number;
  open: ShelterOpen;
  crowd?: CrowdLevel | undefined;
  lastReportMinAgo: number | null;
  attest: AttestState;
  attestUid?: string | undefined;
}

export interface ShelterCardProps {
  shelter: ShelterCardData;
  action?: ReactNode;
  surface?: "shade" | "paper";
  className?: string;
}

const OPEN_PRESENTATION: Record<ShelterOpen, { icon: string; label: string }> = {
  OPEN: { icon: "●", label: "운영 중" },
  CLOSED: { icon: "×", label: "운영 종료" },
  UNKNOWN: { icon: "?", label: "운영 미확인" },
};

const CROWD_PRESENTATION: Record<CrowdLevel, string> = {
  SPARSE: "여유",
  MODERATE: "보통",
  CROWDED: "혼잡",
};

function formatDistance(distanceM: number) {
  if (distanceM < 1_000) return `${Math.round(distanceM)}m`;
  return `${(distanceM / 1_000).toFixed(1)}km`;
}

function formatLastReport(minutes: number | null) {
  return minutes === null ? "확인 기록 없음" : `${minutes}분 전 확인`;
}

export function ShelterCard({
  shelter,
  action,
  surface = "paper",
  className = "",
}: ShelterCardProps) {
  const open = OPEN_PRESENTATION[shelter.open];
  const shadePercent =
    shelter.shadeRatio === undefined ? undefined : Math.round(shelter.shadeRatio * 100);

  return (
    <article
      aria-label={`${shelter.name} 쉼터 정보`}
      data-surface={surface}
      className={`bg-raised border-border rounded-lg border p-4 transition-[border-color,box-shadow] duration-100 hover:border-brand sm:p-6 ${
        surface === "paper" ? "shadow-sh-1 hover:shadow-sh-2" : ""
      } ${className}`}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="t-h3 line-clamp-2 min-w-0">{shelter.name}</h3>
        {shelter.isImBank ? (
          <span
            className="t-caption shrink-0 rounded-full px-2.5 py-1 font-bold text-white"
            style={{ backgroundColor: "var(--im-bank)" }}
          >
            iM뱅크
          </span>
        ) : null}
      </header>

      <p className="t-body-s text-fg-2 mt-2">
        {shelter.facilityType} · {shelter.gu} ·{" "}
        <span className="num">{formatDistance(shelter.distanceM)}</span> · 도보{" "}
        <span className="num">{shelter.walkMin}</span>분
      </p>

      {shelter.roadAddress ? (
        <p className="t-caption text-fg-2 mt-1 line-clamp-1" title={shelter.roadAddress}>
          {shelter.roadAddress}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <span className="t-body-s inline-flex items-center gap-1.5 font-semibold">
          <span aria-hidden="true">{open.icon}</span>
          {open.label}
        </span>
        <span className="t-caption text-fg-2 num">
          {formatLastReport(shelter.lastReportMinAgo)}
        </span>
        {shelter.crowd ? (
          <span className="t-caption border-border rounded-full border px-2.5 py-1">
            {CROWD_PRESENTATION[shelter.crowd]}
          </span>
        ) : null}
        <AttestBadge state={shelter.attest} uid={shelter.attestUid} />
        <span
          className="t-caption border-attest text-attest rounded-full border px-2.5 py-1"
          translate="no"
        >
          Base Sepolia 테스트넷
        </span>
      </div>

      {shadePercent === undefined ? null : (
        <p className="t-body-s mt-4 font-semibold">
          그늘 비율 <span className="num">{shadePercent}</span>%
        </p>
      )}

      {action ? <div className="mt-5">{action}</div> : null}
    </article>
  );
}
