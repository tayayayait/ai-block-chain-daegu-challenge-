import "@tanstack/react-start/server-only";

import { z } from "zod";

import type {
  RouteCandidateUiDto,
  RoutePlanUiDto,
  RouteUiWarningCode,
} from "@/components/routing/route-ui-dto";
import type { RoutePlanDto } from "./service.server";

const DestinationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
  })
  .strict();

const UI_WARNING_CODES = new Set<RouteUiWarningCode>([
  "BARRIER_EVIDENCE_UNCERTAIN",
  "BARRIER_COVERAGE_PARTIAL",
  "REST_GAP_OVER_300M",
  "REST_COVERAGE_PARTIAL",
]);

const AFTER_SUNSET_BANNER = "일몰 후 — 최단 경로로 안내합니다";

function naverDirectionsUrl(
  candidate: RoutePlanDto["candidates"][number],
  destination: z.infer<typeof DestinationSchema>,
): string | null {
  const start = candidate.coordinates[0];
  if (!start) return null;
  const startLabel = encodeURIComponent("출발지");
  const destinationLabel = encodeURIComponent(destination.name);
  return `https://map.naver.com/p/directions/${start[0]},${start[1]},${startLabel}/${destination.longitude},${destination.latitude},${destinationLabel}/-/walk`;
}

function toCandidate(
  candidate: RoutePlanDto["candidates"][number],
  index: number,
  afterSunset: boolean,
): RouteCandidateUiDto {
  const spatialAnalysisAvailable = candidate.analysisState === "COMPLETE";
  const segments =
    (afterSunset || !spatialAnalysisAvailable) && candidate.segments.length === 0
      ? [
          {
            id: `${candidate.id}:neutral`,
            exposure: "NEUTRAL" as const,
            distanceM: candidate.distanceM,
            coordinates: candidate.coordinates,
          },
        ]
      : candidate.segments.map((segment, segmentIndex) => ({
          id: `${candidate.id}:${segmentIndex}`,
          exposure: segment.exposure,
          distanceM: segment.distanceM,
          coordinates: segment.coordinates,
        }));

  return {
    id: candidate.id,
    label: `후보 ${index + 1}` as RouteCandidateUiDto["label"],
    distanceM: candidate.distanceM,
    spatialAnalysisAvailable,
    shadeRatio: afterSunset ? null : candidate.shadeRatio,
    segments,
    shadows: afterSunset || !spatialAnalysisAvailable ? [] : candidate.shadows,
    restSpots: [],
    warnings: candidate.warnings.filter((warning): warning is RouteUiWarningCode =>
      UI_WARNING_CODES.has(warning as RouteUiWarningCode),
    ),
  };
}

export function toRoutePlanUiDto(
  plan: RoutePlanDto,
  rawDestination: { readonly name: string; readonly longitude: number; readonly latitude: number },
): RoutePlanUiDto {
  const destination = DestinationSchema.parse(rawDestination);
  if (plan.state === "FAILED") throw new Error("ROUTE_PLAN_UNAVAILABLE");

  const afterSunset = plan.banner === AFTER_SUNSET_BANNER;
  const eligible = plan.candidates.filter((candidate) => !candidate.excluded).slice(0, 3);
  if (eligible.length === 0) throw new Error("ROUTE_PLAN_UNAVAILABLE");

  return {
    destinationName: destination.name,
    afterSunset,
    shadowCalculatedAt: afterSunset ? null : plan.shadowCalculatedAt,
    naverMapUrl: naverDirectionsUrl(eligible[0]!, destination),
    candidates: eligible.map((candidate, index) => toCandidate(candidate, index, afterSunset)),
  };
}
