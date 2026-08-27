import { AppError } from "@/lib/error-dto";
import type { RiskLevel } from "@/lib/domain-types";

import type { DashboardRepository } from "./repository";
import type { DashboardSearch } from "./search";
import type {
  DashboardCareEvent,
  DashboardL4Alert,
  DashboardSnapshot,
  DashboardSubject,
} from "./types";

const SUBJECTS = Object.freeze([
  {
    id: "subject-1",
    maskedName: "박○○",
    age: 87,
    livesAlone: true,
    gu: "수성구",
    locationLabel: "수성구 파동",
    level: "L4",
    hri: 92,
    feelsLikeC: 39.2,
    reasons: ["체감온도 39.2℃", "고령 독거", "최근 24시간 쉼터 체크인 없음"],
    updatedAt: "2026-08-23T05:03:00.000Z",
  },
  {
    id: "subject-2",
    maskedName: "김○○",
    age: 82,
    livesAlone: true,
    gu: "수성구",
    locationLabel: "수성구 상동",
    level: "L4",
    hri: 88,
    feelsLikeC: 39.2,
    reasons: ["폭염경보 발효 중", "고위험 복약 2개 군", "독거"],
    updatedAt: "2026-08-23T04:58:00.000Z",
  },
  {
    id: "subject-3",
    maskedName: "황○○",
    age: 85,
    livesAlone: true,
    gu: "중구",
    locationLabel: "중구 대신동",
    level: "L3",
    hri: 77,
    feelsLikeC: 39.4,
    reasons: ["체감온도 39.4℃", "고위험 복약 2개 군"],
    updatedAt: "2026-08-23T04:52:00.000Z",
  },
  {
    id: "subject-4",
    maskedName: "최○○",
    age: 84,
    livesAlone: false,
    gu: "달서구",
    locationLabel: "달서구 감삼동",
    level: "L2",
    hri: 58,
    feelsLikeC: 38.9,
    reasons: ["폭염경보 발효 중"],
    updatedAt: "2026-08-23T04:49:00.000Z",
  },
] as const satisfies readonly DashboardSubject[]);

const CARE_EVENTS = Object.freeze([
  {
    id: "demo-care-event-1",
    attestationUid: "0x7a3f9b21c4e5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9d2e1",
    typeLabel: "보호자 알림 발송",
    occurredAt: "2026-08-23T05:03:12.000Z",
    attest: "VERIFIED",
  },
  {
    id: "demo-care-event-2",
    attestationUid: "0x91cd4471aa02bb31cc42dd53ee64ff75aa86bb97cc08dd19ee20ff31aa42b34e",
    typeLabel: "쉼터 체크인",
    occurredAt: "2026-08-23T04:47:05.000Z",
    attest: "VERIFIED",
  },
] as const satisfies readonly DashboardCareEvent[]);

const L4_ALERTS = Object.freeze([
  {
    transitionId: "transition-l4-1",
    subjectId: "subject-1",
    maskedName: "박○○",
    age: 87,
    hri: 92,
    occurredAt: "2026-08-23T05:03:00.000Z",
  },
] as const satisfies readonly DashboardL4Alert[]);

const LEVEL_RANK: Record<RiskLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };

function compareSubjects(
  left: DashboardSubject,
  right: DashboardSubject,
  search: DashboardSearch,
): number {
  const direction = search.order === "asc" ? 1 : -1;
  let comparison = 0;
  if (search.sort === "age") comparison = left.age - right.age;
  else if (search.sort === "updated") {
    comparison = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  } else comparison = left.hri - right.hri;
  return comparison === 0 ? left.id.localeCompare(right.id) : comparison * direction;
}

export interface DemoDashboardRepositoryOptions {
  now?: () => Date;
  missingSources?: readonly string[];
}

/**
 * Safe local adapter for UI development. The repository boundary is identical to
 * the authenticated Supabase adapter and the payload contains masked subjects only.
 */
export function createDemoDashboardRepository(
  options: DemoDashboardRepositoryOptions = {},
): DashboardRepository {
  const acknowledgedByActor = new Map<string, Set<string>>();
  const now = options.now ?? (() => new Date());

  return {
    async read({ actorId, search }) {
      const districtSubjects = SUBJECTS.filter(
        (subject) => search.gu === "전체" || subject.gu === search.gu,
      );
      const urgentSubjects = districtSubjects
        .filter((subject) => LEVEL_RANK[subject.level] >= LEVEL_RANK[search.level])
        .sort((left, right) => compareSubjects(left, right, search))
        .slice(0, 10);
      const acknowledged = acknowledgedByActor.get(actorId) ?? new Set<string>();

      const snapshot: DashboardSnapshot = {
        source: "DEMO_FIXTURE",
        filter: search,
        summary: {
          total: districtSubjects.length,
          averageHri:
            districtSubjects.length === 0
              ? 0
              : Math.round(
                  districtSubjects.reduce((sum, subject) => sum + subject.hri, 0) /
                    districtSubjects.length,
                ),
          byLevel: {
            L2: districtSubjects.filter((subject) => subject.level === "L2").length,
            L3: districtSubjects.filter((subject) => subject.level === "L3").length,
            L4: districtSubjects.filter((subject) => subject.level === "L4").length,
          },
        },
        weather: {
          gu: search.gu === "전체" ? "대구 전체" : search.gu,
          feelsLikeC: 39.2,
          advisory: "WARNING",
          observedAt: "2026-08-23T05:03:00.000Z",
          isPartial: false,
          isStale: false,
        },
        urgentSubjects,
        mapSubjects: urgentSubjects,
        careEvents: CARE_EVENTS,
        unreadL4Alerts: L4_ALERTS.filter(
          (alert) =>
            !acknowledged.has(alert.transitionId) &&
            urgentSubjects.some((subject) => subject.id === alert.subjectId),
        ),
        missingSources: [...(options.missingSources ?? [])],
        fetchedAt: now().toISOString(),
      };

      return snapshot;
    },
    async acknowledgeL4({ actorId, transitionId }) {
      if (!L4_ALERTS.some((alert) => alert.transitionId === transitionId)) {
        throw new AppError("INVALID_REQUEST");
      }
      const acknowledged = acknowledgedByActor.get(actorId) ?? new Set<string>();
      acknowledged.add(transitionId);
      acknowledgedByActor.set(actorId, acknowledged);
    },
  };
}
