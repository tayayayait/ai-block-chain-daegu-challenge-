import type { RiskLevel } from "@/lib/domain-types";

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  L0: "안전",
  L1: "관심",
  L2: "주의",
  L3: "경고",
  L4: "위험",
};

// 색맹 대응 — 등급마다 다른 형태 (규칙 B-1)
export const LEVEL_SHAPE: Record<RiskLevel, string> = {
  L0: "●",
  L1: "◆",
  L2: "▲",
  L3: "■",
  L4: "✕",
};

export const LEVEL_ACTION: Record<RiskLevel, string> = {
  L0: "자동 조치 없음",
  L1: "대시보드 표시만",
  L2: "주의 대상 강조",
  L3: "보호자 알림 + 쉼터 경로 발송",
  L4: "담당자 즉시 알림 + 응급 연계 안내",
};
