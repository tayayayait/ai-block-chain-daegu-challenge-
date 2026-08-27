import type { RouteCandidateUiDto, RouteUiWarningCode } from "./route-ui-dto";

export const ELDER_WALKING_SPEED_MPS = 0.75;

export const ACCESSIBILITY_CANDIDATE_NOTICE =
  "TMAP 보행 후보입니다. 그늘·장애물·휴식시설 정보는 공간자료가 확보된 범위에서만 표시합니다. 미등록 계단·급경사·휴식시설 운영 여부는 보장하지 않으므로 이동 전 현장을 확인하세요.";

const WARNING_MESSAGE: Readonly<Record<RouteUiWarningCode, string>> = {
  BARRIER_EVIDENCE_UNCERTAIN: "계단·급경사 정보 중 확인되지 않은 항목이 있습니다.",
  BARRIER_COVERAGE_PARTIAL: "장애물 자료가 제공되는 구역이 제한적입니다.",
  REST_GAP_OVER_300M: "확인된 휴식 지점 사이가 300m를 넘는 구간이 있습니다.",
  REST_COVERAGE_PARTIAL: "휴식 지점 자료가 일부 구역만 제공됩니다.",
};

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function warningMessage(code: RouteUiWarningCode): string {
  return WARNING_MESSAGE[code];
}

export function formatRouteDistance(distanceM: number): string {
  const safeDistance = nonNegative(distanceM);
  if (safeDistance < 1_000) return `${Math.round(safeDistance)}m`;
  return `${(safeDistance / 1_000).toFixed(safeDistance < 10_000 ? 1 : 0)}km`;
}

export function summarizeRouteCandidate(candidate: RouteCandidateUiDto) {
  const distanceM = nonNegative(candidate.distanceM);
  const elderDurationSec = Math.ceil(distanceM / ELDER_WALKING_SPEED_MPS);
  const sunlight = candidate.segments.filter(
    (segment) => segment.exposure === "SUN" && nonNegative(segment.distanceM) > 0,
  );
  const rawShadeRatio = candidate.shadeRatio;
  const shadePercent =
    rawShadeRatio === null || !Number.isFinite(rawShadeRatio)
      ? null
      : Math.round(Math.min(1, Math.max(0, rawShadeRatio)) * 100);

  return {
    distanceM,
    distanceLabel: formatRouteDistance(distanceM),
    elderDurationSec,
    walkingMinutes: Math.max(1, Math.ceil(elderDurationSec / 60)),
    spatialAnalysisAvailable: candidate.spatialAnalysisAvailable,
    shadePercent,
    sunSegmentCount: sunlight.length,
    sunDistanceM: Math.round(
      sunlight.reduce((total, segment) => total + nonNegative(segment.distanceM), 0),
    ),
    restSpotCount: candidate.restSpots.length,
  } as const;
}
