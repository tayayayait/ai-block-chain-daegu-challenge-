import { LEVEL_LABEL, LEVEL_SHAPE } from "@/lib/risk/presentation";
import type { AttestState, RiskLevel } from "@/lib/domain-types";

/** 등급 배지 — 색 + 텍스트 라벨 + 형태 3중 표기 (규칙 C-3, B-1) */
export function RiskBadge({ level, className = "" }: { level: RiskLevel; className?: string }) {
  const heat = `var(--heat-${level.slice(1)})`;
  const isL4 = level === "L4";
  const backgroundMix = level === "L0" || level === "L1" ? 12 : 14;
  return (
    <span
      className={`t-caption inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 font-semibold ${isL4 ? "pulse-l4" : ""} ${className}`}
      style={
        isL4
          ? { backgroundColor: heat, color: "#FFFFFF" }
          : {
              backgroundColor: `color-mix(in oklab, ${heat} ${backgroundMix}%, transparent)`,
              color: heat,
            }
      }
    >
      <span aria-hidden="true">{LEVEL_SHAPE[level]}</span>
      {level} {LEVEL_LABEL[level]}
    </span>
  );
}

const ATTEST_TEXT: Record<AttestState, string> = {
  VERIFIED: "✓ 검증됨",
  PENDING: "⋯ 기록 중…",
  UNVERIFIED: "미검증",
  FAILED: "기록 실패",
};

export function AttestBadge({
  state,
  uid,
  className = "",
}: {
  state: AttestState;
  uid?: string | undefined;
  className?: string;
}) {
  const style =
    state === "VERIFIED"
      ? { backgroundColor: "var(--attest-bg)", color: "var(--attest)" }
      : state === "FAILED"
        ? { color: "var(--danger)", border: "1px solid var(--danger)" }
        : state === "UNVERIFIED"
          ? { color: "var(--fg-3)", border: "1px dashed var(--fg-3)" }
          : { color: "var(--fg-3)" };

  const inner = (
    <span
      className={`t-caption inline-flex h-6 items-center gap-1 rounded-full px-2.5 font-semibold ${className}`}
      style={style}
      translate="no"
    >
      {ATTEST_TEXT[state]}
    </span>
  );

  if (state === "VERIFIED" && uid) {
    return (
      <a
        href={`/verify/${uid}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Base Sepolia 테스트넷 온체인 증명 검증 열기"
      >
        {inner}
      </a>
    );
  }
  return inner;
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="t-caption border-border h-9 shrink-0 rounded-full border px-3.5 font-semibold transition-colors duration-100"
      style={
        active
          ? { backgroundColor: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }
          : { color: "var(--fg-2)" }
      }
    >
      {children}
    </button>
  );
}
