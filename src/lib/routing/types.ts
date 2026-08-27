export type GeoPosition = readonly [longitude: number, latitude: number];
export type TmapPedestrianSearchOption = "0" | "4" | "10" | "30";

export interface RouteCandidate {
  readonly id: string;
  readonly source: "TMAP";
  readonly searchOption: TmapPedestrianSearchOption;
  readonly coordinates: readonly GeoPosition[];
  readonly distanceM: number;
  readonly elderDurationSec: number;
  readonly providerDurationSec: number | null;
}

export type SpatialCoverage = "DAEGU_ALL" | "PARK_ONLY" | "DISTRICT_ONLY" | "COMMUNITY_PARTIAL";

export type SpatialConfidence = "VERIFIED_SOURCE" | "DERIVED" | "COMMUNITY" | "UNKNOWN";

export type BarrierGeometry =
  | { readonly type: "LineString"; readonly coordinates: readonly GeoPosition[] }
  | { readonly type: "MultiLineString"; readonly coordinates: readonly (readonly GeoPosition[])[] }
  | { readonly type: "Polygon"; readonly coordinates: readonly (readonly GeoPosition[])[] }
  | {
      readonly type: "MultiPolygon";
      readonly coordinates: readonly (readonly (readonly GeoPosition[])[])[];
    };

export interface BarrierEvidence {
  readonly id: string;
  readonly barrierType: "STAIRS" | "STEEP_SLOPE";
  readonly slopePercent: number | null;
  readonly confidence: SpatialConfidence;
  readonly coverage: SpatialCoverage;
  readonly unknownReason: string | null;
  readonly geometry: BarrierGeometry;
}

export interface MatchedRestSpot {
  readonly id: string;
  readonly distanceAlongRouteM: number;
}

export type SunState =
  | { readonly kind: "AFTER_SUNSET" }
  | {
      readonly kind: "DAYLIGHT";
      readonly altitudeRad: number;
      readonly azimuthRad: number;
    };
