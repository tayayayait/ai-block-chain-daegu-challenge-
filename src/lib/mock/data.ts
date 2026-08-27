// 목데이터 — 실제 서비스에서는 기상청/식약처/EAS/Naver/TMAP 연동으로 대체된다.
import type {
  AttestState,
  CrowdLevel,
  HeatAdvisory,
  MedRiskTier,
  MedSource,
  RiskLevel,
  ShelterOpen,
} from "@/lib/domain-types";
import { HEAT_CLASS_TIER } from "@/lib/medication/heat-classes";
import { computeHri, type HriInput, type HriResult } from "@/lib/risk/hri";
import { buildHriReasons } from "@/lib/risk/reasons";

export interface WeatherNow {
  gu: string;
  feelsLikeC: number;
  advisory: HeatAdvisory;
  tropicalNightStreak: number;
  observedAt: string; // KST 표시용
}

export const weatherNow: WeatherNow = {
  gu: "수성구",
  feelsLikeC: 39.2,
  advisory: "WARNING",
  tropicalNightStreak: 4,
  observedAt: "2026-08-23 14:00 KST",
};

export interface Medication {
  id: string;
  productName: string;
  itemSeq?: string | undefined;
  heatClass: string | null;
  riskTier: MedRiskTier;
  source: MedSource;
  confidence: number | null;
}

export interface Subject {
  id: string;
  name: string;
  maskedName: string;
  age: number;
  sex: "여" | "남";
  gu: string;
  address: string;
  guardianName: string;
  guardianPhone: string;
  livesAlone: boolean;
  chronicDisease: boolean;
  hasCooling: boolean;
  medRegistered: boolean;
  medications: Medication[];
  checkInVerified24h: boolean;
  feelsLikeC: number;
  lat: number;
  lng: number;
}

const med = (
  id: string,
  productName: string,
  heatClass: string | null,
  source: MedSource,
  confidence: number | null,
  itemSeq?: string,
): Medication => ({
  id,
  productName,
  heatClass,
  riskTier: heatClass ? (HEAT_CLASS_TIER[heatClass] ?? "NONE") : "NONE",
  source,
  confidence,
  itemSeq,
});

export const subjects: Subject[] = [
  {
    id: "s-001",
    name: "박정순",
    maskedName: "박○○",
    age: 87,
    sex: "여",
    gu: "수성구",
    address: "수성구 파동로3길 62",
    guardianName: "박○○ (자녀)",
    guardianPhone: "010-****-7712",
    livesAlone: true,
    chronicDisease: true,
    hasCooling: false,
    medRegistered: true,
    medications: [
      med("m-1", "라식스정 40mg", "이뇨제", "AI_AUTO", 0.94, "195700020"),
      med("m-2", "지르텍정 10mg", "1세대 항히스타민제", "AI_CONFIRMED", 0.71),
      med("m-3", "노바스크정 5mg", "칼슘채널길항제", "AI_AUTO", 0.91),
    ],
    checkInVerified24h: false,
    feelsLikeC: 39.2,
    lat: 35.8281,
    lng: 128.6321,
  },
  {
    id: "s-002",
    name: "김말순",
    maskedName: "김○○",
    age: 82,
    sex: "여",
    gu: "수성구",
    address: "수성구 상동 15-4",
    guardianName: "김○○ (자녀)",
    guardianPhone: "010-****-2201",
    livesAlone: true,
    chronicDisease: true,
    hasCooling: true,
    medRegistered: true,
    medications: [
      med("m-4", "라식스정 40mg", "이뇨제", "AI_AUTO", 0.96),
      med("m-5", "아리셉트정 5mg", "항치매제", "AI_AUTO", 0.89),
      med("m-6", "부스파정 5mg", "항불안제·근이완제", "AI_CONFIRMED", 0.68),
    ],
    checkInVerified24h: false,
    feelsLikeC: 39.2,
    lat: 35.8404,
    lng: 128.6215,
  },
  {
    id: "s-003",
    name: "이복동",
    maskedName: "이○○",
    age: 79,
    sex: "남",
    gu: "중구",
    address: "중구 남산동 2길 11",
    guardianName: "이○○ (자녀)",
    guardianPhone: "010-****-4457",
    livesAlone: true,
    chronicDisease: false,
    hasCooling: false,
    medRegistered: true,
    medications: [
      med("m-7", "아빌리파이정 5mg", "항정신병제", "AI_AUTO", 0.92),
      med("m-8", "니트로글리세린설하정", "질산염·혈관확장제", "MANUAL", null),
    ],
    checkInVerified24h: false,
    feelsLikeC: 38.6,
    lat: 35.8632,
    lng: 128.591,
  },
  {
    id: "s-004",
    name: "최영자",
    maskedName: "최○○",
    age: 84,
    sex: "여",
    gu: "달서구",
    address: "달서구 감삼동 88-2",
    guardianName: "최○○ (자녀)",
    guardianPhone: "010-****-3040",
    livesAlone: false,
    chronicDisease: true,
    hasCooling: true,
    medRegistered: true,
    medications: [
      med("m-9", "노바스크정 5mg", "칼슘채널길항제", "AI_AUTO", 0.93),
      med("m-10", "딜라트렌정 12.5mg", "혈압강하제", "AI_AUTO", 0.88),
    ],
    checkInVerified24h: true,
    feelsLikeC: 38.9,
    lat: 35.8419,
    lng: 128.5566,
  },
  {
    id: "s-005",
    name: "정순분",
    maskedName: "정○○",
    age: 91,
    sex: "여",
    gu: "서구",
    address: "서구 비산동 401-7",
    guardianName: "정○○ (조카)",
    guardianPhone: "010-****-8890",
    livesAlone: true,
    chronicDisease: true,
    hasCooling: false,
    medRegistered: false,
    medications: [],
    checkInVerified24h: false,
    feelsLikeC: 39.0,
    lat: 35.8815,
    lng: 128.5602,
  },
  {
    id: "s-006",
    name: "한기동",
    maskedName: "한○○",
    age: 72,
    sex: "남",
    gu: "동구",
    address: "동구 신암동 33-9",
    guardianName: "한○○ (배우자)",
    guardianPhone: "010-****-7788",
    livesAlone: false,
    chronicDisease: false,
    hasCooling: true,
    medRegistered: true,
    medications: [med("m-11", "테그레톨정 200mg", "항간질제", "AI_AUTO", 0.9)],
    checkInVerified24h: true,
    feelsLikeC: 37.4,
    lat: 35.8858,
    lng: 128.6265,
  },
  {
    id: "s-007",
    name: "오분남",
    maskedName: "오○○",
    age: 88,
    sex: "여",
    gu: "북구",
    address: "북구 산격동 1287",
    guardianName: "오○○ (자녀)",
    guardianPhone: "010-****-9902",
    livesAlone: true,
    chronicDisease: false,
    hasCooling: true,
    medRegistered: true,
    medications: [med("m-12", "부스코판정", "항콜린제", "AI_AUTO", 0.87)],
    checkInVerified24h: false,
    feelsLikeC: 38.2,
    lat: 35.8931,
    lng: 128.6083,
  },
  {
    id: "s-008",
    name: "서길수",
    maskedName: "서○○",
    age: 68,
    sex: "남",
    gu: "남구",
    address: "남구 대명동 1731",
    guardianName: "서○○ (자녀)",
    guardianPhone: "010-****-1120",
    livesAlone: false,
    chronicDisease: false,
    hasCooling: true,
    medRegistered: true,
    medications: [],
    checkInVerified24h: true,
    feelsLikeC: 33.8,
    lat: 35.8412,
    lng: 128.5891,
  },
  {
    id: "s-009",
    name: "권덕례",
    maskedName: "권○○",
    age: 76,
    sex: "여",
    gu: "달성군",
    address: "달성군 화원읍 성산리 62",
    guardianName: "권○○ (자녀)",
    guardianPhone: "010-****-4413",
    livesAlone: true,
    chronicDisease: true,
    hasCooling: true,
    medRegistered: true,
    medications: [med("m-13", "프로작캡슐 20mg", "항우울제", "AI_CONFIRMED", 0.74)],
    checkInVerified24h: false,
    feelsLikeC: 36.1,
    lat: 35.7852,
    lng: 128.5062,
  },
  {
    id: "s-010",
    name: "배순임",
    maskedName: "배○○",
    age: 81,
    sex: "여",
    gu: "수성구",
    address: "수성구 지산동 1201",
    guardianName: "배○○ (자녀)",
    guardianPhone: "010-****-2039",
    livesAlone: false,
    chronicDisease: true,
    hasCooling: true,
    medRegistered: true,
    medications: [med("m-14", "리튬카보네이트정", "리튬", "AI_AUTO", 0.9)],
    checkInVerified24h: false,
    feelsLikeC: 35.6,
    lat: 35.8322,
    lng: 128.6432,
  },
  {
    id: "s-011",
    name: "문태식",
    maskedName: "문○○",
    age: 66,
    sex: "남",
    gu: "북구",
    address: "북구 태전동 902",
    guardianName: "문○○ (자녀)",
    guardianPhone: "010-****-0021",
    livesAlone: true,
    chronicDisease: false,
    hasCooling: true,
    medRegistered: true,
    medications: [],
    checkInVerified24h: false,
    feelsLikeC: 30.2,
    lat: 35.9214,
    lng: 128.5583,
  },
  {
    id: "s-012",
    name: "황금순",
    maskedName: "황○○",
    age: 85,
    sex: "여",
    gu: "중구",
    address: "중구 대신동 115-201",
    guardianName: "황○○ (자녀)",
    guardianPhone: "010-****-1198",
    livesAlone: true,
    chronicDisease: true,
    hasCooling: false,
    medRegistered: true,
    medications: [
      med("m-15", "라식스정 40mg", "이뇨제", "AI_AUTO", 0.95),
      med("m-16", "쿠에타핀정 25mg", "항정신병제", "AI_AUTO", 0.86),
      med("m-17", "노바스크정 5mg", "칼슘채널길항제", "AI_AUTO", 0.92),
    ],
    checkInVerified24h: false,
    feelsLikeC: 39.4,
    lat: 35.8698,
    lng: 128.5809,
  },
];

export function medCounts(s: Subject) {
  const high = new Set<string>();
  const mid = new Set<string>();
  for (const m of s.medications) {
    if (!m.heatClass) continue;
    if (m.riskTier === "HIGH") high.add(m.heatClass);
    else if (m.riskTier === "MID") mid.add(m.heatClass);
  }
  return { medHigh: high.size, medMid: mid.size };
}

export interface HriViewResult extends HriResult {
  reasons: string[];
}

export function riskOf(s: Subject): HriViewResult {
  const { medHigh, medMid } = medCounts(s);
  const input: HriInput = {
    feelsLikeC: s.feelsLikeC,
    heatAdvisory: s.feelsLikeC >= 38 ? "WARNING" : s.feelsLikeC >= 35 ? "WATCH" : "NONE",
    tropicalNightStreak: s.feelsLikeC >= 35 ? weatherNow.tropicalNightStreak : 0,
    medHigh,
    medMid,
    medRegistered: s.medRegistered,
    age: s.age,
    livesAlone: s.livesAlone,
    chronicDisease: s.chronicDisease,
    noCooling: !s.hasCooling,
    shelterCheckInVerified24h: s.checkInVerified24h,
  };
  const result = computeHri(input);

  return { ...result, reasons: buildHriReasons(input, result) };
}

export const getSubject = (id: string) => subjects.find((s) => s.id === id);

export function rankedSubjects() {
  return subjects
    .map((s) => ({ subject: s, risk: riskOf(s) }))
    .sort((a, b) => b.risk.score - a.risk.score);
}

export interface Shelter {
  id: string;
  name: string;
  gu: string;
  facilityType: string;
  isImBank: boolean;
  roadAddress: string;
  distanceM: number;
  walkMin: number;
  shadeRatio: number;
  open: ShelterOpen;
  crowd: CrowdLevel;
  lastReportMinAgo: number | null;
  attest: AttestState;
  attestUid?: string | undefined;
  x: number; // 개략 지도 좌표 (0–100)
  y: number;
}

export const shelters: Shelter[] = [
  {
    id: "DG-0001",
    name: "iM뱅크 서문시장지점",
    gu: "중구",
    facilityType: "금융기관",
    isImBank: true,
    roadAddress: "중구 대신동 115-378",
    distanceM: 320,
    walkMin: 7,
    shadeRatio: 0.68,
    open: "OPEN",
    crowd: "MODERATE",
    lastReportMinAgo: 14,
    attest: "VERIFIED",
    attestUid: "0x7a3f9b21c4e5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9d2e1",
    x: 34,
    y: 46,
  },
  {
    id: "DG-0002",
    name: "파동행정복지센터",
    gu: "수성구",
    facilityType: "행정복지센터",
    isImBank: false,
    roadAddress: "수성구 파동로 51",
    distanceM: 460,
    walkMin: 10,
    shadeRatio: 0.52,
    open: "OPEN",
    crowd: "SPARSE",
    lastReportMinAgo: 42,
    attest: "VERIFIED",
    attestUid: "0x91cd4471aa02bb31cc42dd53ee64ff75aa86bb97cc08dd19ee20ff31aa42b34e",
    x: 62,
    y: 70,
  },
  {
    id: "DG-0003",
    name: "상동경로당",
    gu: "수성구",
    facilityType: "경로당",
    isImBank: false,
    roadAddress: "수성구 상동 22-1",
    distanceM: 210,
    walkMin: 5,
    shadeRatio: 0.31,
    open: "UNKNOWN",
    crowd: "SPARSE",
    lastReportMinAgo: null,
    attest: "UNVERIFIED",
    x: 55,
    y: 58,
  },
  {
    id: "DG-0004",
    name: "iM뱅크 수성동지점",
    gu: "수성구",
    facilityType: "금융기관",
    isImBank: true,
    roadAddress: "수성구 수성동4가 1013",
    distanceM: 690,
    walkMin: 15,
    shadeRatio: 0.74,
    open: "OPEN",
    crowd: "SPARSE",
    lastReportMinAgo: 6,
    attest: "VERIFIED",
    attestUid: "0x2b7e1150aa9dcc31bb42ee53ff6411a286bb97cc08dd19ee20ff31aa42bc99f0",
    x: 71,
    y: 44,
  },
  {
    id: "DG-0005",
    name: "지산2동 경로당",
    gu: "수성구",
    facilityType: "경로당",
    isImBank: false,
    roadAddress: "수성구 지산동 1180",
    distanceM: 830,
    walkMin: 18,
    shadeRatio: 0.44,
    open: "CLOSED",
    crowd: "SPARSE",
    lastReportMinAgo: 25,
    attest: "PENDING",
    x: 79,
    y: 66,
  },
  {
    id: "DG-0006",
    name: "대구시립중앙도서관",
    gu: "중구",
    facilityType: "기타",
    isImBank: false,
    roadAddress: "중구 국채보상로 492",
    distanceM: 1120,
    walkMin: 25,
    shadeRatio: 0.61,
    open: "OPEN",
    crowd: "CROWDED",
    lastReportMinAgo: 31,
    attest: "VERIFIED",
    attestUid: "0x55aa12bb34cc56dd78ee90ff12aa34bb56cc78dd90ee12ff34aa56bb78cc0011",
    x: 41,
    y: 33,
  },
];

export const getShelter = (id: string) => shelters.find((s) => s.id === id);

export interface CareEvent {
  uid: string;
  subjectId: string;
  subjectHash: string;
  type: "VISIT" | "SHELTER_CHECKIN" | "ALERT_SENT";
  typeLabel: string;
  riskLevel: RiskLevel;
  hri: number;
  occurredAt: string;
  attest: AttestState;
  issuer: string;
  payloadHash: string;
  detail: string;
}

export const careEvents: CareEvent[] = [
  {
    uid: "0x7a3f9b21c4e5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9d2e1",
    subjectId: "s-002",
    subjectHash: "0x7a3f4412bb90cc11dd22ee33ff44aa55bb66cc77dd88ee99ff00aa11bb22d2e1",
    type: "ALERT_SENT",
    typeLabel: "보호자 알림 발송",
    riskLevel: "L3",
    hri: 72,
    occurredAt: "2026-08-23 14:03:12 KST",
    attest: "VERIFIED",
    issuer: "0x4B2c88f10aa93bb21cc45dd67ee89ff01aa23b8Af0",
    payloadHash: "0xd41d8cd98f00b204e9800998ecf8427e0aa11bb22cc33dd44ee55ff66aa77b88",
    detail: "쉼터 경로 3건 포함 알림톡 발송",
  },
  {
    uid: "0x91cd4471aa02bb31cc42dd53ee64ff75aa86bb97cc08dd19ee20ff31aa42b34e",
    subjectId: "s-004",
    subjectHash: "0x91cd0022aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33b34e",
    type: "SHELTER_CHECKIN",
    typeLabel: "쉼터 체크인 (iM뱅크 서문시장지점)",
    riskLevel: "L2",
    hri: 58,
    occurredAt: "2026-08-23 13:47:05 KST",
    attest: "VERIFIED",
    issuer: "0x4B2c88f10aa93bb21cc45dd67ee89ff01aa23b8Af0",
    payloadHash: "0x2c26b46b68ffc68ff99b453c1d30413413422445aa11bb22cc33dd44ee55ff66",
    detail: "체크인 확인 → 완화 점수 −6 적용",
  },
  {
    uid: "0x2b7e1150aa9dcc31bb42ee53ff6411a286bb97cc08dd19ee20ff31aa42bc99f0",
    subjectId: "s-001",
    subjectHash: "0x2b7e9911aa22bb33cc44dd55ee66ff77aa88bb99cc00dd11ee22ff33aa44c99f0",
    type: "ALERT_SENT",
    typeLabel: "담당자 즉시 알림",
    riskLevel: "L4",
    hri: 92,
    occurredAt: "2026-08-23 13:32:44 KST",
    attest: "VERIFIED",
    issuer: "0x4B2c88f10aa93bb21cc45dd67ee89ff01aa23b8Af0",
    payloadHash: "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    detail: "응급 연계 안내 표시 + 생활지원사 방문 배정",
  },
  {
    uid: "0x55aa12bb34cc56dd78ee90ff12aa34bb56cc78dd90ee12ff34aa56bb78cc0011",
    subjectId: "s-006",
    subjectHash: "0x55aa7788bb99cc00dd11ee22ff33aa44bb55cc66dd77ee88ff99aa00bb110011",
    type: "VISIT",
    typeLabel: "생활지원사 방문",
    riskLevel: "L1",
    hri: 34,
    occurredAt: "2026-08-23 11:10:02 KST",
    attest: "VERIFIED",
    issuer: "0x4B2c88f10aa93bb21cc45dd67ee89ff01aa23b8Af0",
    payloadHash: "0x6dcd4ce23d88e2ee9568ba546c007c63d9131c1b2233445566778899aabbccdd",
    detail: "체감온도 확인 및 냉방 가동 안내",
  },
];

export const getCareEvent = (uid: string) => careEvents.find((e) => e.uid === uid);

export const getEventForSubject = (subjectId: string) =>
  careEvents.filter((e) => e.subjectId === subjectId);

export const DISCLAIMER =
  "이 정보는 폭염 위험도 계산용 참고 자료입니다. 복약 변경은 반드시 의사·약사와 상의하세요.";

export const CHAIN_NOTE =
  "이 기록은 발급 이후 누구도 수정·삭제할 수 없습니다. 돌봄 예산 집행의 감사 증빙으로 사용됩니다.";
