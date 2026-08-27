import type { SunState, TmapPedestrianSearchOption } from "./types";

export const ACCESSIBILITY_NOTICE =
  "TMAP 계단 제외 옵션과 공개 공간자료를 반영한 후보입니다. 미등록 계단·급경사·휴식시설 운영 여부는 보장하지 않으므로 이동 전 현장을 확인하세요.";

export interface ScoredRouteInput {
  readonly id: string;
  readonly durationSec: number;
  readonly distanceM: number;
  readonly shadeRatio: number;
  readonly restSpotDensity: number;
  readonly excluded: boolean;
  readonly searchOption?: TmapPedestrianSearchOption;
}

export interface RankedRoute extends ScoredRouteInput {
  readonly durationNorm: number;
  readonly score: number;
}

function compareRanked(a: RankedRoute, b: RankedRoute): number {
  return (
    b.score - a.score ||
    a.durationSec - b.durationSec ||
    a.distanceM - b.distanceM ||
    a.id.localeCompare(b.id)
  );
}

function assertCandidate(candidate: ScoredRouteInput): void {
  if (
    !candidate.id.trim() ||
    !Number.isFinite(candidate.durationSec) ||
    candidate.durationSec < 0 ||
    !Number.isFinite(candidate.distanceM) ||
    candidate.distanceM < 0 ||
    !Number.isFinite(candidate.shadeRatio) ||
    candidate.shadeRatio < 0 ||
    candidate.shadeRatio > 1 ||
    !Number.isFinite(candidate.restSpotDensity) ||
    candidate.restSpotDensity < 0 ||
    candidate.restSpotDensity > 1
  ) {
    throw new RangeError("INVALID_ROUTE_SCORE_INPUT");
  }
}

export function accessibilityNoticeForOption(
  searchOption: TmapPedestrianSearchOption | undefined,
): string {
  if (searchOption === undefined || searchOption === "30") return ACCESSIBILITY_NOTICE;
  return `TMAP ${searchOption} 옵션 후보입니다. 계단 제외 옵션을 요청한 경로가 아니며, 미등록 계단·급경사·휴식시설 운영 여부는 보장하지 않으므로 이동 전 현장을 확인하세요.`;
}

export function rankRoutes(candidates: readonly ScoredRouteInput[]): readonly RankedRoute[] {
  candidates.forEach(assertCandidate);
  const eligible = candidates.filter((candidate) => !candidate.excluded);
  if (eligible.length === 0) return [];
  const durations = eligible.map((candidate) => candidate.durationSec);
  const minimumDuration = Math.min(...durations);
  const maximumDuration = Math.max(...durations);
  return eligible
    .map((candidate) => {
      const durationNorm =
        maximumDuration === minimumDuration
          ? 0
          : (candidate.durationSec - minimumDuration) / (maximumDuration - minimumDuration);
      return {
        ...candidate,
        durationNorm,
        score:
          candidate.shadeRatio * 0.6 + (1 - durationNorm) * 0.25 + candidate.restSpotDensity * 0.15,
      };
    })
    .sort(compareRanked);
}

export class RouteSelectionError extends Error {
  readonly code = "NO_ELIGIBLE_ROUTE";

  constructor() {
    super("No eligible route candidate is available.");
    this.name = "RouteSelectionError";
  }
}

export function selectRoutePlan(candidates: readonly ScoredRouteInput[], sun: SunState) {
  candidates.forEach(assertCandidate);
  const eligible = candidates.filter((candidate) => !candidate.excluded);
  if (eligible.length === 0) throw new RouteSelectionError();
  if (sun.kind === "AFTER_SUNSET") {
    const ranked = [...eligible].sort(
      (a, b) =>
        a.distanceM - b.distanceM || a.durationSec - b.durationSec || a.id.localeCompare(b.id),
    );
    const selected = ranked[0]!;
    return {
      selected,
      ranked,
      banner: "일몰 후 — 최단 경로로 안내합니다",
      notice: accessibilityNoticeForOption(selected.searchOption),
      claim: "DEMO_ACCESSIBILITY_CANDIDATE" as const,
    };
  }
  const ranked = rankRoutes(eligible);
  return {
    selected: ranked[0]!,
    ranked,
    banner: null,
    notice: accessibilityNoticeForOption(ranked[0]!.searchOption),
    claim: "DEMO_ACCESSIBILITY_CANDIDATE" as const,
  };
}
