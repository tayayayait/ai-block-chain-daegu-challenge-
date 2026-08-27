import type { NaverMapsLoadState } from "@/lib/naver/maps-loader";

export type RouteUiCoordinate = readonly [longitude: number, latitude: number];

export type RouteUiExposure = "SHADE" | "SUN" | "NEUTRAL";

export type RouteShadowUiDto =
  | {
      readonly type: "Polygon";
      readonly coordinates: readonly (readonly RouteUiCoordinate[])[];
    }
  | {
      readonly type: "MultiPolygon";
      readonly coordinates: readonly (readonly (readonly RouteUiCoordinate[])[])[];
    };

export type RouteUiWarningCode =
  | "BARRIER_EVIDENCE_UNCERTAIN"
  | "BARRIER_COVERAGE_PARTIAL"
  | "REST_GAP_OVER_300M"
  | "REST_COVERAGE_PARTIAL";

/**
 * Browser-safe route segment. It deliberately excludes provider payloads,
 * subject identifiers, cache keys and database records.
 */
export interface RouteSegmentUiDto {
  readonly id: string;
  readonly exposure: RouteUiExposure;
  readonly distanceM: number;
  readonly coordinates: readonly RouteUiCoordinate[];
}

export interface RouteRestSpotUiDto {
  readonly id: string;
  readonly label: string;
  readonly distanceAlongRouteM: number;
}

export interface RouteCandidateUiDto {
  readonly id: string;
  readonly label: "후보 1" | "후보 2" | "후보 3";
  readonly distanceM: number;
  readonly spatialAnalysisAvailable: boolean;
  readonly shadeRatio: number | null;
  readonly segments: readonly RouteSegmentUiDto[];
  readonly shadows: readonly RouteShadowUiDto[];
  readonly restSpots: readonly RouteRestSpotUiDto[];
  readonly warnings: readonly RouteUiWarningCode[];
}

export interface RoutePlanUiDto {
  readonly destinationName: string;
  readonly afterSunset: boolean;
  readonly shadowCalculatedAt: string | null;
  readonly naverMapUrl: string | null;
  readonly candidates: readonly RouteCandidateUiDto[];
}

export type DepartureOffsetMinutes = 0 | 30 | 60;

export interface DepartureComparisonSlotUiDto {
  readonly offsetMinutes: DepartureOffsetMinutes;
  readonly label: "지금 출발" | "30분 후" | "1시간 후";
  readonly departureAt: string;
  readonly feelsLikeC: number | null;
  readonly forecastAt: string | null;
  readonly forecastInterpolated: boolean;
  readonly shadePercent: number | null;
  readonly directSunMinutes: number | null;
  readonly walkingMinutes: number;
  readonly additionalWalkingMinutes: number;
  readonly plan: RoutePlanUiDto;
}

export interface DepartureComparisonUiDto {
  readonly recommendedOffsetMinutes: DepartureOffsetMinutes;
  readonly forecastSource: "KMA_VILLAGE_FORECAST" | "UNAVAILABLE";
  readonly slots: readonly DepartureComparisonSlotUiDto[];
}

export type NaverRouteMapsLoaderPort = Readonly<{
  getState(): NaverMapsLoadState;
  subscribe(listener: (state: NaverMapsLoadState) => void): () => void;
  load(): Promise<void>;
}>;
