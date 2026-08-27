import type { RiskCardProps } from "@/components/onjung/RiskCard";
import type { ShelterCardData } from "@/components/onjung/ShelterCard";
import type { ToastEntry } from "@/components/onjung/Toast";

export const DEMO_RISK_CASES = [
  {
    level: "L0",
    score: 12,
    subject: { maskedName: "가상 A○○", age: 67, livesAlone: false },
    feelsLikeC: 29.5,
    location: "가상구",
    reasons: ["평상시 관찰 상태"],
  },
  {
    level: "L1",
    score: 33,
    subject: { maskedName: "가상 B○○", age: 71, livesAlone: false },
    feelsLikeC: 32.1,
    location: "가상구",
    reasons: ["체감온도 상승"],
  },
  {
    level: "L2",
    score: 55,
    subject: { maskedName: "가상 C○○", age: 78, livesAlone: true },
    feelsLikeC: 35.4,
    location: "가상구",
    reasons: ["고령", "독거"],
  },
  {
    level: "L3",
    score: 74,
    subject: { maskedName: "가상 D○○", age: 84, livesAlone: true },
    feelsLikeC: 38.2,
    location: "가상구",
    reasons: ["체감온도 38℃ 이상", "고령", "냉방 취약"],
  },
  {
    level: "L4",
    score: 93,
    subject: { maskedName: "가상 E○○", age: 90, livesAlone: true },
    feelsLikeC: 40.1,
    location: "가상구",
    reasons: ["즉시 확인 필요", "고령 독거", "쉼터 미확인"],
  },
] as const satisfies readonly Omit<RiskCardProps, "surface" | "action" | "className">[];

export const DEMO_SHELTERS = [
  {
    id: "DEMO-OPEN",
    name: "가상 온중쉼터 열린점",
    gu: "가상구",
    facilityType: "금융기관",
    isImBank: true,
    roadAddress: "가상로 1",
    distanceM: 240,
    walkMin: 5,
    shadeRatio: 0.78,
    open: "OPEN",
    crowd: "SPARSE",
    lastReportMinAgo: 7,
    attest: "VERIFIED",
    attestUid: "demo-attestation-open",
  },
  {
    id: "DEMO-CLOSED",
    name: "가상 온중쉼터 닫힌점",
    gu: "가상구",
    facilityType: "경로당",
    isImBank: false,
    roadAddress: "가상로 2",
    distanceM: 580,
    walkMin: 12,
    shadeRatio: 0.42,
    open: "CLOSED",
    crowd: "MODERATE",
    lastReportMinAgo: 32,
    attest: "PENDING",
  },
  {
    id: "DEMO-UNKNOWN",
    name: "가상 온중쉼터 미확인점",
    gu: "가상구",
    facilityType: "도서관",
    isImBank: false,
    roadAddress: "가상로 3",
    distanceM: 920,
    walkMin: 19,
    shadeRatio: 0.61,
    open: "UNKNOWN",
    crowd: "CROWDED",
    lastReportMinAgo: null,
    attest: "UNVERIFIED",
  },
  {
    id: "DEMO-FAILED",
    name: "가상 온중쉼터 기록실패점",
    gu: "가상구",
    facilityType: "행정복지센터",
    isImBank: false,
    roadAddress: "가상로 4",
    distanceM: 1_250,
    walkMin: 25,
    shadeRatio: 0.55,
    open: "OPEN",
    crowd: "MODERATE",
    lastReportMinAgo: 51,
    attest: "FAILED",
  },
] as const satisfies readonly ShelterCardData[];

export interface DemoTableRow {
  id: string;
  maskedName: string;
  level: string;
  score: number;
}

export const DEMO_TABLE_ROWS: readonly DemoTableRow[] = Array.from({ length: 55 }, (_, index) => ({
  id: `DEMO-ROW-${String(index + 1).padStart(2, "0")}`,
  maskedName: `가상 대상 ${String(index + 1).padStart(2, "0")}`,
  level: `L${index % 5}`,
  score: (index * 7) % 101,
}));

const demoAction = () => undefined;

export const DEMO_TOASTS = [
  { id: "demo-success", kind: "success", message: "가상 저장이 완료되었습니다." },
  { id: "demo-info", kind: "info", message: "가상 데이터를 갱신하고 있습니다." },
  {
    id: "demo-error",
    kind: "error",
    message: "가상 요청을 처리하지 못했습니다.",
    action: { label: "다시 시도", onClick: demoAction },
  },
] satisfies readonly ToastEntry[];
