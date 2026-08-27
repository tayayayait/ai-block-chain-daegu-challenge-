import { useEffect, useMemo, useRef, useState } from "react";

import { NaverMapsLoader, type NaverMapsLoadState } from "@/lib/naver/maps-loader";

import type {
  NaverRouteMapsLoaderPort,
  RouteCandidateUiDto,
  RouteSegmentUiDto,
  RouteShadowUiDto,
  RouteUiCoordinate,
} from "./route-ui-dto";

export const ROUTE_STROKES = {
  SHADE: {
    strokeColor: "#0b6e6b",
    strokeWeight: 6,
    strokeStyle: "solid",
    strokeOpacity: 1,
  },
  SUN: {
    strokeColor: "#d2601a",
    strokeWeight: 6,
    strokeStyle: "solid",
    strokeOpacity: 1,
  },
  NEUTRAL: {
    strokeColor: "#4f626c",
    strokeWeight: 6,
    strokeStyle: "solid",
    strokeOpacity: 1,
  },
  ALTERNATIVE: {
    strokeColor: "#7a8c93",
    strokeWeight: 4,
    strokeStyle: "shortdash",
    strokeOpacity: 0.9,
  },
} as const;

export const ROUTE_SHADOW_STYLE = {
  fillColor: "#1e293b",
  fillOpacity: 0.1,
  strokeColor: "#334155",
  strokeOpacity: 0,
  strokeWeight: 0,
  clickable: false,
  zIndex: 15,
} as const;

export const ROUTE_CASING_STYLE = {
  strokeColor: "#ffffff",
  strokeWeight: 10,
  strokeStyle: "solid",
  strokeOpacity: 0.95,
  zIndex: 25,
} as const;

const EMPTY_ROUTE_SHADOWS: readonly RouteShadowUiDto[] = [];

interface NaverMapInstance {
  fitBounds(bounds: unknown, padding?: number): void;
}

interface NaverOverlayInstance {
  setMap(map: null): void;
  setPaths?(paths: unknown): void;
}

interface NaverMapsApi {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => NaverMapInstance;
  LatLng: new (latitude: number, longitude: number) => unknown;
  LatLngBounds: new () => { extend(point: unknown): void };
  Polyline: new (options: Record<string, unknown>) => NaverOverlayInstance;
  Polygon?: new (options: Record<string, unknown>) => NaverOverlayInstance;
  Marker?: new (options: Record<string, unknown>) => NaverOverlayInstance;
}

function startLocationMarkerContent(): string {
  return `<div style="position:relative;width:34px;height:44px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.35));cursor:pointer;"><svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 0C7.61116 0 0 7.61116 0 17C0 27.5 14.5 42 17 44C19.5 42 34 26.5 34 17C34 7.61116 26.3888 0 17 0Z" fill="#00C73C" stroke="#FFFFFF" stroke-width="2"/><text x="17" y="17" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', sans-serif" font-size="11px" font-weight="700" text-anchor="middle" dominant-baseline="central">출발</text></svg></div>`;
}

function destinationMarkerContent(): string {
  return `<div style="position:relative;width:34px;height:44px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.35));cursor:pointer;"><svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 0C7.61116 0 0 7.61116 0 17C0 27.5 14.5 42 17 44C19.5 42 34 26.5 34 17C34 7.61116 26.3888 0 17 0Z" fill="#E53935" stroke="#FFFFFF" stroke-width="2"/><text x="17" y="17" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', sans-serif" font-size="11px" font-weight="700" text-anchor="middle" dominant-baseline="central">도착</text></svg></div>`;
}

function getNaverMapsApi(): NaverMapsApi | null {
  return (window as Window & { naver?: { maps?: NaverMapsApi } }).naver?.maps ?? null;
}

function validCoordinate(coordinate: RouteUiCoordinate): boolean {
  const [longitude, latitude] = coordinate;
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

function validSegmentCoordinates(segment: RouteSegmentUiDto): readonly RouteUiCoordinate[] {
  const coordinates = segment.coordinates.filter(validCoordinate);
  return coordinates.length >= 2 ? coordinates : [];
}

function polygonParts(
  shadow: RouteShadowUiDto,
): readonly (readonly (readonly RouteUiCoordinate[])[])[] {
  return shadow.type === "Polygon" ? [shadow.coordinates] : shadow.coordinates;
}

function clearOverlays(overlays: NaverOverlayInstance[]): void {
  overlays.forEach((overlay) => {
    try {
      overlay.setMap(null);
    } catch {
      // A rejected third-party SDK can leave partially initialized overlays.
    }
  });
  overlays.length = 0;
}

function routeGeometryKey(
  selected: RouteCandidateUiDto,
  alternatives: readonly RouteCandidateUiDto[],
): string {
  return JSON.stringify({
    selected: [selected.id, selected.segments],
    alternatives: alternatives.map((candidate) => [candidate.id, candidate.segments]),
  });
}

function shadowPaths(maps: NaverMapsApi, shadows: readonly RouteShadowUiDto[]): readonly unknown[] {
  const result: unknown[] = [];
  for (const shadow of shadows) {
    for (const polygon of polygonParts(shadow)) {
      const paths = polygon
        .map((ring) => ring.filter(validCoordinate))
        .filter((ring) => ring.length >= 4)
        .map((ring) => ring.map(([longitude, latitude]) => new maps.LatLng(latitude, longitude)));
      if (paths.length > 0) result.push(paths);
    }
  }
  return result;
}

function formatShadowCalculatedAt(value: string | null): string | null {
  if (!value) return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const month = number("month");
  const day = number("day");
  const hour = number("hour");
  const minute = number("minute");
  if (![month, day, hour, minute].every(Number.isFinite)) return null;
  const period = hour < 12 ? "오전" : "오후";
  const displayHour = hour % 12 || 12;
  return `${month}월 ${day}일 ${period} ${displayHour}:${String(minute).padStart(2, "0")} 기준`;
}

const STATE_MESSAGE: Partial<Record<NaverMapsLoadState, string>> = {
  MISSING_KEY_ID: "지도 공개 식별자가 설정되지 않았습니다.",
  AUTH_FAILED: "지도 인증을 확인하지 못했습니다.",
  LOAD_FAILED: "지도를 불러오지 못했습니다.",
};

function segmentLabel(segment: RouteSegmentUiDto, index: number): string {
  const exposureLabel =
    segment.exposure === "SHADE" ? "그늘" : segment.exposure === "SUN" ? "햇빛" : "보행 경로";
  return `${index + 1}구간 · ${exposureLabel} · ${Math.round(Math.max(0, segment.distanceM))}m`;
}

export function NaverRouteMap({
  selected,
  alternatives,
  ncpKeyId = import.meta.env["VITE_NAVER_MAPS_NCP_KEY_ID"] ?? "",
  loader,
  afterSunset = false,
  shadowCalculatedAt = null,
}: {
  selected: RouteCandidateUiDto;
  alternatives: readonly RouteCandidateUiDto[];
  ncpKeyId?: string;
  loader?: NaverRouteMapsLoaderPort;
  afterSunset?: boolean;
  shadowCalculatedAt?: string | null;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<NaverMapInstance | null>(null);
  const routeOverlaysRef = useRef<NaverOverlayInstance[]>([]);
  const shadowOverlaysRef = useRef<NaverOverlayInstance[]>([]);
  const renderedRouteGeometryKeyRef = useRef<string | null>(null);
  const renderedShadowGeometryKeyRef = useRef<string | null>(null);
  const selectedShadows = selected.shadows ?? EMPTY_ROUTE_SHADOWS;
  const [showShadows, setShowShadows] = useState(true);
  const currentRouteGeometryKey = routeGeometryKey(selected, alternatives);
  const currentShadowGeometryKey = showShadows ? JSON.stringify(selectedShadows) : "SHADOWS_HIDDEN";
  const actualLoader = useMemo<NaverRouteMapsLoaderPort | null>(
    () =>
      loader ??
      (typeof document === "undefined" || typeof window === "undefined"
        ? null
        : new NaverMapsLoader({ ncpKeyId })),
    [loader, ncpKeyId],
  );
  const [state, setState] = useState<NaverMapsLoadState>(
    () => loader?.getState() ?? (ncpKeyId.trim() ? "IDLE" : "MISSING_KEY_ID"),
  );

  useEffect(() => {
    if (!actualLoader) return;
    setState(actualLoader.getState());
    const unsubscribe = actualLoader.subscribe(setState);
    void actualLoader.load().catch(() => undefined);
    return unsubscribe;
  }, [actualLoader]);

  useEffect(() => {
    if (state !== "READY" || !canvasRef.current) return;
    const maps = getNaverMapsApi();
    if (!maps) return;

    if (
      mapRef.current !== null &&
      renderedRouteGeometryKeyRef.current === currentRouteGeometryKey
    ) {
      return;
    }

    const allCoordinates = [
      ...alternatives.flatMap((candidate) =>
        candidate.segments.flatMap((segment) => validSegmentCoordinates(segment)),
      ),
      ...selected.segments.flatMap((segment) => validSegmentCoordinates(segment)),
    ];
    const first = allCoordinates[0];
    if (!first) {
      clearOverlays(routeOverlaysRef.current);
      clearOverlays(shadowOverlaysRef.current);
      renderedRouteGeometryKeyRef.current = currentRouteGeometryKey;
      renderedShadowGeometryKeyRef.current = null;
      return;
    }

    try {
      mapRef.current ??= new maps.Map(canvasRef.current, {
        center: new maps.LatLng(first[1], first[0]),
        zoom: 15,
        minZoom: 10,
      });
      clearOverlays(routeOverlaysRef.current);
      const bounds = new maps.LatLngBounds();

      const addPolyline = (
        coordinates: readonly RouteUiCoordinate[],
        style: (typeof ROUTE_STROKES)[keyof typeof ROUTE_STROKES] | typeof ROUTE_CASING_STYLE,
        zIndex: number,
      ) => {
        if (coordinates.length < 2) return;
        const path = coordinates.map(([longitude, latitude]) => {
          const point = new maps.LatLng(latitude, longitude);
          bounds.extend(point);
          return point;
        });
        routeOverlaysRef.current.push(
          new maps.Polyline({
            map: mapRef.current,
            path,
            ...style,
            strokeLineCap: "round",
            strokeLineJoin: "round",
            zIndex,
          }),
        );
      };

      for (const candidate of alternatives) {
        for (const segment of candidate.segments) {
          addPolyline(validSegmentCoordinates(segment), ROUTE_STROKES.ALTERNATIVE, 10);
        }
      }

      if (showShadows && maps.Polygon && shadowOverlaysRef.current.length === 0) {
        for (const paths of shadowPaths(maps, selectedShadows)) {
          shadowOverlaysRef.current.push(
            new maps.Polygon({
              map: mapRef.current,
              paths,
              ...ROUTE_SHADOW_STYLE,
            }),
          );
        }
        renderedShadowGeometryKeyRef.current = currentShadowGeometryKey;
      }

      // 1. Render white casing under the selected route for sharp contrast
      for (const segment of selected.segments) {
        addPolyline(
          validSegmentCoordinates(segment),
          ROUTE_CASING_STYLE,
          ROUTE_CASING_STYLE.zIndex,
        );
      }

      // 2. Render colored shade/sun segments on top
      for (const segment of selected.segments) {
        addPolyline(validSegmentCoordinates(segment), ROUTE_STROKES[segment.exposure], 30);
      }

      const selectedCoords = selected.segments.flatMap(validSegmentCoordinates);
      const startCoord = selectedCoords[0];
      const endCoord = selectedCoords[selectedCoords.length - 1];

      if (maps.Marker && startCoord) {
        const startPos = new maps.LatLng(startCoord[1], startCoord[0]);
        bounds.extend(startPos);
        routeOverlaysRef.current.push(
          new maps.Marker({
            map: mapRef.current,
            position: startPos,
            title: "출발 위치",
            zIndex: 100,
            icon: {
              content: startLocationMarkerContent(),
              anchor: { x: 17, y: 44 },
            },
          }),
        );
      }

      if (maps.Marker && endCoord) {
        const endPos = new maps.LatLng(endCoord[1], endCoord[0]);
        bounds.extend(endPos);
        routeOverlaysRef.current.push(
          new maps.Marker({
            map: mapRef.current,
            position: endPos,
            title: "도착 위치",
            zIndex: 100,
            icon: {
              content: destinationMarkerContent(),
              anchor: { x: 17, y: 44 },
            },
          }),
        );
      }

      mapRef.current.fitBounds(bounds, 56);
      renderedRouteGeometryKeyRef.current = currentRouteGeometryKey;
    } catch {
      clearOverlays(routeOverlaysRef.current);
      clearOverlays(shadowOverlaysRef.current);
      mapRef.current = null;
      renderedRouteGeometryKeyRef.current = null;
      renderedShadowGeometryKeyRef.current = null;
      setState("LOAD_FAILED");
    }
  }, [
    alternatives,
    currentRouteGeometryKey,
    currentShadowGeometryKey,
    selected,
    selectedShadows,
    showShadows,
    state,
  ]);

  useEffect(() => {
    if (state !== "READY" || mapRef.current === null) return;
    const maps = getNaverMapsApi();
    if (!maps) return;
    if (renderedShadowGeometryKeyRef.current === currentShadowGeometryKey) return;

    if (!showShadows || !maps.Polygon) {
      clearOverlays(shadowOverlaysRef.current);
      renderedShadowGeometryKeyRef.current = currentShadowGeometryKey;
      return;
    }

    try {
      const nextPaths = shadowPaths(maps, selectedShadows);
      const canUpdateExisting =
        shadowOverlaysRef.current.length === nextPaths.length &&
        shadowOverlaysRef.current.every((overlay) => typeof overlay.setPaths === "function");

      if (canUpdateExisting) {
        shadowOverlaysRef.current.forEach((overlay, index) => {
          overlay.setPaths?.(nextPaths[index]);
        });
      } else {
        clearOverlays(shadowOverlaysRef.current);
        for (const paths of nextPaths) {
          shadowOverlaysRef.current.push(
            new maps.Polygon({
              map: mapRef.current,
              paths,
              ...ROUTE_SHADOW_STYLE,
            }),
          );
        }
      }
      renderedShadowGeometryKeyRef.current = currentShadowGeometryKey;
    } catch {
      clearOverlays(shadowOverlaysRef.current);
      renderedShadowGeometryKeyRef.current = null;
    }
  }, [currentShadowGeometryKey, selectedShadows, showShadows, state]);

  useEffect(
    () => () => {
      clearOverlays(routeOverlaysRef.current);
      clearOverlays(shadowOverlaysRef.current);
      mapRef.current = null;
      renderedRouteGeometryKeyRef.current = null;
      renderedShadowGeometryKeyRef.current = null;
    },
    [],
  );

  const errorMessage = STATE_MESSAGE[state];
  const formattedShadowTime = formatShadowCalculatedAt(shadowCalculatedAt);
  const showTimeAwareShadow =
    !afterSunset && selected.spatialAnalysisAvailable && formattedShadowTime !== null;

  return (
    <section
      aria-label="보행 경로 지도와 구간 안내"
      className="overflow-hidden rounded-xl border border-border bg-raised shadow-sh-1"
    >
      <div className="relative">
        <div
          ref={canvasRef}
          data-testid="naver-route-map-canvas"
          aria-hidden="true"
          className="h-[360px] w-full bg-[radial-gradient(circle_at_20%_20%,color-mix(in_oklab,var(--heat-0)_13%,transparent),transparent_38%),linear-gradient(145deg,var(--overlay),var(--raised))] lg:h-[560px]"
        />
        <div
          aria-label="지도 범례"
          className="absolute top-3 left-3 max-w-[calc(100%-1.5rem)] rounded-lg border border-border bg-overlay/95 p-2.5 shadow-sh-2 backdrop-blur-md"
        >
          {showTimeAwareShadow ? (
            <div className="mb-2 flex items-center justify-between gap-3 border-b border-border pb-2">
              <div>
                <p className="t-caption font-bold text-brand">시간 그림자</p>
                <p className="t-caption text-[11px] text-fg-2">{formattedShadowTime}</p>
              </div>
              {selectedShadows.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowShadows((prev) => !prev)}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    showShadows
                      ? "bg-brand/15 text-brand hover:bg-brand/25"
                      : "bg-surface text-fg-3 hover:text-fg-1"
                  }`}
                  aria-pressed={showShadows}
                  aria-label="건물 그림자 표시 전환"
                >
                  <span className={`size-2 rounded-full ${showShadows ? "bg-brand" : "bg-fg-3"}`} />
                  {showShadows ? "그림자 켬" : "그림자 끔"}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {afterSunset || !selected.spatialAnalysisAvailable ? (
              <span className="t-caption flex items-center gap-1.5 text-fg-2">
                <span className="h-1.5 w-6 rounded-full bg-fg-2" />
                {afterSunset ? "최단 보행 경로" : "보행 경로"}
              </span>
            ) : (
              <>
                {selectedShadows.length > 0 && showShadows ? (
                  <span className="t-caption flex items-center gap-1.5 text-fg-2">
                    <span className="h-2.5 w-4 rounded-sm bg-slate-700/30" />
                    건물 예상 그림자
                  </span>
                ) : null}
                <span className="t-caption flex items-center gap-1.5 font-medium text-heat-0">
                  <span className="h-2 w-6 rounded-full bg-heat-0" />
                  그늘
                </span>
                <span className="t-caption flex items-center gap-1.5 font-medium text-heat-2">
                  <span className="h-2 w-6 rounded-full bg-heat-2" />
                  햇빛
                </span>
              </>
            )}
            <span className="t-caption flex items-center gap-1.5 text-fg-3">
              <span className="w-6 border-t-2 border-dashed border-fg-3" />
              다른 후보
            </span>
          </div>
        </div>
      </div>

      {showTimeAwareShadow ? (
        <div
          className="border-t border-border bg-[color-mix(in_oklab,var(--brand)_5%,var(--raised))] px-4 py-3"
          role="note"
        >
          <p className="t-caption text-fg-2">
            건물 높이(일부 층수 기반 추정)와 태양 위치로 계산한 예상 그림자입니다. 수목·차양·공사
            상황은 현장과 다를 수 있습니다.
          </p>
        </div>
      ) : null}

      {state === "LOADING" ? (
        <p className="t-body-s border-t border-border p-4 text-fg-2" role="status">
          지도를 불러오는 중입니다. 구간 목록은 먼저 이용할 수 있습니다.
        </p>
      ) : null}
      {errorMessage ? (
        <div className="border-t border-border p-4" role="note">
          <p className="t-body-s font-semibold">{errorMessage}</p>
          <p className="t-caption mt-1 text-fg-2">
            지도 없이도 아래 구간 목록에서 같은 정보를 확인할 수 있습니다.
          </p>
        </div>
      ) : null}

      <div className="border-t border-border p-4">
        <h3 className="t-caption font-bold text-fg-2">선택 경로 구간</h3>
        <ol aria-label="선택 경로 구간 목록" className="mt-2 grid gap-2 sm:grid-cols-2">
          {selected.segments.map((segment, index) => (
            <li
              key={segment.id}
              className="t-body-s flex items-center gap-2 rounded-md bg-background px-3 py-2"
            >
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-full ${
                  segment.exposure === "SHADE"
                    ? "bg-heat-0"
                    : segment.exposure === "SUN"
                      ? "bg-heat-2"
                      : "bg-fg-2"
                }`}
              />
              {segmentLabel(segment, index)}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
