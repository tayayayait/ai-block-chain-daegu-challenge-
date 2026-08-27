import { useEffect, useMemo, useRef, useState } from "react";

import type { ShelterOpen } from "@/lib/domain-types";
import { NaverMapsLoader, type NaverMapsLoadState } from "@/lib/naver/maps-loader";

export interface ShelterMapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  open: ShelterOpen;
  isImBank: boolean;
}

export interface HeatReliefMapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: "BENCH" | "PAVILION" | "SHADE_CANOPY" | "PARK_FACILITY";
  district?: string | null;
  detail?: string | null;
  address?: string | null;
  source?: string | null;
  distanceM?: number;
  condition?: string | null;
  repairRequired?: boolean | null;
  datasetUpdatedAt?: string | null;
}

type PointMarker = ShelterMapPoint & { kind: "POINT"; count: 1 };
type ClusterMarker = {
  kind: "CLUSTER";
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  open: "UNKNOWN";
  isImBank: false;
  count: number;
};

export type ShelterMapMarker = PointMarker | ClusterMarker;

type HeatReliefPointMarker = HeatReliefMapPoint & { kind: "RELIEF_POINT"; count: 1 };
type HeatReliefClusterMarker = {
  kind: "RELIEF_CLUSTER";
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: "MIXED";
  count: number;
  points: readonly HeatReliefMapPoint[];
};

export type HeatReliefMapMarker = HeatReliefPointMarker | HeatReliefClusterMarker;

export type NaverMapsLoaderPort = Readonly<{
  getState(): NaverMapsLoadState;
  subscribe(listener: (state: NaverMapsLoadState) => void): () => void;
  load(): Promise<void>;
}>;

interface NaverMapInstance {
  fitBounds(bounds: unknown, padding?: number): void;
  setCenter?(latLng: unknown): void;
  setZoom?(zoom: number, animate?: boolean): void;
  getZoom?(): number;
  panTo?(latLng: unknown): void;
}

interface NaverMarkerInstance {
  setMap(map: null): void;
}

interface NaverMapsApi {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => NaverMapInstance;
  LatLng: new (latitude: number, longitude: number) => unknown;
  LatLngBounds: new () => { extend(point: unknown): void };
  Marker: new (options: Record<string, unknown>) => NaverMarkerInstance;
  Event: {
    addListener(target: unknown, eventName: string, listener: () => void): unknown;
    removeListener(listener: unknown): void;
  };
}

function getNaverMapsApi(): NaverMapsApi | null {
  const maps = (
    window as Window & {
      naver?: { maps?: NaverMapsApi };
    }
  ).naver?.maps;
  return maps ?? null;
}

export function clusterShelterMapPoints(
  points: readonly ShelterMapPoint[],
  zoom = 14,
): ShelterMapMarker[] {
  if (zoom >= 16 || points.length <= 50) {
    return points.map((entry) => ({ ...entry, kind: "POINT", count: 1 }));
  }

  const gridSize = zoom <= 12 ? 0.012 : zoom === 13 ? 0.006 : zoom === 14 ? 0.003 : 0.0015;

  const cells = new Map<string, ShelterMapPoint[]>();
  for (const entry of points) {
    const key = `${Math.floor(entry.latitude / gridSize)}:${Math.floor(entry.longitude / gridSize)}`;
    const group = cells.get(key) ?? [];
    group.push(entry);
    cells.set(key, group);
  }

  return [...cells.entries()].map(([key, group]) => {
    const only = group[0];
    if (group.length === 1 && only) return { ...only, kind: "POINT", count: 1 };
    return {
      kind: "CLUSTER",
      id: `cluster:${key}`,
      name: `${group.length}개 쉼터 모음`,
      latitude: group.reduce((sum, entry) => sum + entry.latitude, 0) / group.length,
      longitude: group.reduce((sum, entry) => sum + entry.longitude, 0) / group.length,
      open: "UNKNOWN",
      isImBank: false,
      count: group.length,
    };
  });
}

export function clusterHeatReliefMapPoints(
  points: readonly HeatReliefMapPoint[],
  zoom = 14,
): HeatReliefMapMarker[] {
  if (zoom >= 16 || points.length <= 30) {
    return points.map((entry) => ({ ...entry, kind: "RELIEF_POINT", count: 1 }));
  }

  const gridSize = zoom <= 12 ? 0.01 : zoom === 13 ? 0.005 : zoom === 14 ? 0.0025 : 0.001;

  const cells = new Map<string, HeatReliefMapPoint[]>();
  for (const entry of points) {
    const key = `${Math.floor(entry.latitude / gridSize)}:${Math.floor(entry.longitude / gridSize)}`;
    const group = cells.get(key) ?? [];
    group.push(entry);
    cells.set(key, group);
  }
  return [...cells.entries()].map(([key, group]) => {
    const only = group[0];
    if (group.length === 1 && only) return { ...only, kind: "RELIEF_POINT", count: 1 };
    return {
      kind: "RELIEF_CLUSTER",
      id: `relief-cluster:${key}`,
      name: `폭염 안전시설 ${group.length}곳`,
      latitude: group.reduce((sum, entry) => sum + entry.latitude, 0) / group.length,
      longitude: group.reduce((sum, entry) => sum + entry.longitude, 0) / group.length,
      type: "MIXED",
      count: group.length,
      points: group,
    };
  });
}

function markerContent(marker: ShelterMapMarker, selected: boolean): string {
  const color =
    marker.kind === "CLUSTER"
      ? "var(--foreground)"
      : marker.isImBank
        ? "var(--im-bank)"
        : marker.open === "OPEN"
          ? "var(--safe)"
          : "var(--fg-3)";
  const radius = marker.kind === "CLUSTER" ? "20px" : marker.isImBank ? "8px" : "999px";
  const label = marker.kind === "CLUSTER" ? String(marker.count) : marker.isImBank ? "iM" : "";
  return `<div style="display:grid;place-items:center;width:${marker.kind === "CLUSTER" ? "42px" : "28px"};height:${marker.kind === "CLUSTER" ? "42px" : "28px"};border-radius:${radius};background:${color};border:${selected ? "4px solid #1e293b" : "2px solid white"};box-shadow:0 2px 8px rgba(0,0,0,.3);color:white;font:700 12px/1 sans-serif;cursor:pointer;">${label}</div>`;
}

export const RELIEF_TYPE_DETAILS = {
  SHADE_CANOPY: {
    label: "그늘막",
    shortLabel: "그",
    badgeClass: "bg-amber-600 text-white",
    color: "#d97706",
  },
  BENCH: {
    label: "벤치",
    shortLabel: "벤",
    badgeClass: "bg-teal-700 text-white",
    color: "#0f766e",
  },
  PAVILION: {
    label: "정자",
    shortLabel: "정",
    badgeClass: "bg-emerald-700 text-white",
    color: "#047857",
  },
  PARK_FACILITY: {
    label: "공원시설",
    shortLabel: "공",
    badgeClass: "bg-slate-700 text-white",
    color: "#334155",
  },
} as const;

export function formatHeatReliefSourceLabel(source?: string | null): string {
  if (!source) return "공공데이터";
  switch (source) {
    case "NATIONAL_STANDARD_CSV":
      return "행정안전부 전국그늘막표준데이터";
    case "DAEGU_DISTRICT_CSV":
      return "대구 구·군 그늘막 현황";
    case "SUSEONG_SHADE_API":
      return "수성구 그늘막 API";
    case "DONGGU_SMART_SHADE_API":
      return "동구 스마트그늘막 API";
    case "DAEGU_PARK_FACILITY_API":
      return "대구시 공원시설물 API";
    case "OPENSTREETMAP":
      return "OpenStreetMap";
    default:
      return source;
  }
}

function heatReliefMarkerContent(marker: HeatReliefMapMarker, selected: boolean): string {
  if (marker.kind === "RELIEF_CLUSTER") {
    return `<div style="display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--heat-2);border:${selected ? "3px solid #0f172a" : "3px solid white"};box-shadow:0 3px 9px rgba(0,0,0,.3);color:white;font:800 12px/1 sans-serif;cursor:pointer;" title="${marker.name} (클릭하여 확대)">${marker.count}</div>`;
  }
  const config = RELIEF_TYPE_DETAILS[marker.type];
  return `<div style="display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:${config.color};border:${selected ? "3px solid #0f172a" : "2px solid white"};box-shadow:0 3px 8px rgba(0,0,0,.26);color:white;font:800 11px/1 sans-serif;cursor:pointer;transform:${selected ? "scale(1.15)" : "scale(1)"};" title="${marker.name} (클릭하여 정보 보기)">${config.shortLabel}</div>`;
}

function startLocationMarkerContent(): string {
  return `<div style="position:relative;width:34px;height:44px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.35));cursor:pointer;"><svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 0C7.61116 0 0 7.61116 0 17C0 27.5 14.5 42 17 44C19.5 42 34 27.5 34 17C34 7.61116 26.3888 0 17 0Z" fill="#00C73C" stroke="#FFFFFF" stroke-width="2"/><text x="17" y="17" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', sans-serif" font-size="11px" font-weight="700" text-anchor="middle" dominant-baseline="central">출발</text></svg></div>`;
}

// The viewport is only re-fitted when the ground it has to cover changes, so panning and zooming
// by hand survives a re-render. Counting the markers is not enough for that: switching the 구·군
// filter usually returns just as many shelters somewhere else entirely, which left the map sitting
// over the previous district. The key is read from the incoming points rather than the clustered
// markers because cluster centres shift with the zoom level, which would re-fit the map on every
// zoom the user makes.
function viewportFitKey(
  points: readonly ShelterMapPoint[],
  reliefPoints: readonly HeatReliefMapPoint[],
  currentLocation?: Readonly<{ latitude: number; longitude: number }> | null,
): string {
  const latitudes: number[] = [];
  const longitudes: number[] = [];
  for (const point of [...points, ...reliefPoints, ...(currentLocation ? [currentLocation] : [])]) {
    latitudes.push(point.latitude);
    longitudes.push(point.longitude);
  }
  if (latitudes.length === 0) return "empty";
  return [
    points.length,
    reliefPoints.length,
    Math.min(...latitudes).toFixed(5),
    Math.max(...latitudes).toFixed(5),
    Math.min(...longitudes).toFixed(5),
    Math.max(...longitudes).toFixed(5),
  ].join(":");
}

const STATE_MESSAGE: Partial<Record<NaverMapsLoadState, string>> = {
  MISSING_KEY_ID: "지도 공개 식별자가 설정되지 않았습니다.",
  AUTH_FAILED: "지도 인증을 확인하지 못했습니다.",
  LOAD_FAILED: "지도를 불러오지 못했습니다.",
};

const EMPTY_RELIEF_POINTS: readonly HeatReliefMapPoint[] = Object.freeze([]);

type SelectedClusterDetails = {
  name: string;
  count: number;
  counts: { BENCH: number; PAVILION: number; SHADE_CANOPY: number; PARK_FACILITY: number };
  samplePoints: readonly HeatReliefMapPoint[];
};

export function NaverShelterMap({
  points,
  reliefPoints = EMPTY_RELIEF_POINTS,
  currentLocation,
  selectedId,
  onSelect,
  ncpKeyId = import.meta.env["VITE_NAVER_MAPS_NCP_KEY_ID"] ?? "",
  loader,
}: {
  points: readonly ShelterMapPoint[];
  reliefPoints?: readonly HeatReliefMapPoint[];
  currentLocation?: { latitude: number; longitude: number } | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  ncpKeyId?: string;
  loader?: NaverMapsLoaderPort;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<NaverMapInstance | null>(null);
  const markersRef = useRef<NaverMarkerInstance[]>([]);
  const listenersRef = useRef<unknown[]>([]);
  const fitKeyRef = useRef<string>("");
  const [zoom, setZoom] = useState(14);
  const [showReliefPoints, setShowReliefPoints] = useState(true);
  const [selectedReliefPoint, setSelectedReliefPoint] = useState<HeatReliefMapPoint | null>(null);
  const [selectedClusterInfo, setSelectedClusterInfo] = useState<SelectedClusterDetails | null>(
    null,
  );

  const actualLoader = useMemo<NaverMapsLoaderPort | null>(
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
  const clustered = useMemo(() => clusterShelterMapPoints(points, zoom), [points, zoom]);
  const clusteredRelief = useMemo(
    () => clusterHeatReliefMapPoints(reliefPoints, zoom),
    [reliefPoints, zoom],
  );
  const reliefCounts = useMemo(
    () =>
      reliefPoints.reduce(
        (counts, point) => {
          counts[point.type] += 1;
          return counts;
        },
        { BENCH: 0, PAVILION: 0, SHADE_CANOPY: 0, PARK_FACILITY: 0 },
      ),
    [reliefPoints],
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
    const clearArtifacts = () => {
      markersRef.current.forEach((marker) => {
        try {
          marker.setMap(null);
        } catch {
          // A rejected third-party SDK can leave partially initialized markers.
        }
      });
      listenersRef.current.forEach((listener) => {
        try {
          maps.Event.removeListener(listener);
        } catch {
          // Keep the list usable even when NAVER Maps cleanup fails.
        }
      });
      markersRef.current = [];
      listenersRef.current = [];
    };

    try {
      const center = currentLocation ??
        points[0] ??
        reliefPoints[0] ?? { latitude: 35.8714, longitude: 128.6014 };

      if (!mapRef.current) {
        mapRef.current = new maps.Map(canvasRef.current, {
          center: new maps.LatLng(center.latitude, center.longitude),
          zoom: 14,
          minZoom: 10,
        });
      }

      clearArtifacts();

      const zoomListener = maps.Event.addListener(mapRef.current, "zoom_changed", () => {
        if (!mapRef.current) return;
        const currentZoom =
          typeof mapRef.current.getZoom === "function" ? mapRef.current.getZoom() : 14;
        setZoom(currentZoom);
      });
      listenersRef.current.push(zoomListener);

      const bounds = new maps.LatLngBounds();

      for (const marker of clustered) {
        const position = new maps.LatLng(marker.latitude, marker.longitude);
        bounds.extend(position);
        const instance = new maps.Marker({
          map: mapRef.current,
          position,
          title: marker.name,
          icon: {
            content: markerContent(marker, marker.id === selectedId),
            anchor: {
              x: marker.kind === "CLUSTER" ? 21 : 14,
              y: marker.kind === "CLUSTER" ? 21 : 14,
            },
          },
        });
        markersRef.current.push(instance);
        if (marker.kind === "POINT" && onSelect) {
          listenersRef.current.push(
            maps.Event.addListener(instance, "click", () => {
              setSelectedReliefPoint(null);
              setSelectedClusterInfo(null);
              onSelect(marker.id);
            }),
          );
        } else if (marker.kind === "CLUSTER") {
          listenersRef.current.push(
            maps.Event.addListener(instance, "click", () => {
              if (!mapRef.current) return;
              const pos = new maps.LatLng(marker.latitude, marker.longitude);
              const currentZoom =
                typeof mapRef.current.getZoom === "function" ? mapRef.current.getZoom() : 14;
              const targetZoom = Math.max(currentZoom + 2, 17);
              if (typeof mapRef.current.setZoom === "function") {
                mapRef.current.setZoom(targetZoom, true);
              }
              if (typeof mapRef.current.panTo === "function") {
                mapRef.current.panTo(pos);
              } else if (typeof mapRef.current.setCenter === "function") {
                mapRef.current.setCenter(pos);
              }
            }),
          );
        }
      }

      if (showReliefPoints) {
        for (const marker of clusteredRelief) {
          const position = new maps.LatLng(marker.latitude, marker.longitude);
          bounds.extend(position);
          const isSelected =
            marker.kind === "RELIEF_POINT" && marker.id === selectedReliefPoint?.id;
          const instance = new maps.Marker({
            map: mapRef.current,
            position,
            title: marker.name,
            icon: {
              content: heatReliefMarkerContent(marker, isSelected),
              anchor: {
                x: marker.kind === "RELIEF_CLUSTER" ? 19 : 14,
                y: marker.kind === "RELIEF_CLUSTER" ? 19 : 14,
              },
            },
          });
          markersRef.current.push(instance);

          if (marker.kind === "RELIEF_CLUSTER") {
            listenersRef.current.push(
              maps.Event.addListener(instance, "click", () => {
                setSelectedReliefPoint(null);
                const pts = marker.points || [];
                const clusterCounts = pts.reduce(
                  (acc, p) => {
                    acc[p.type] = (acc[p.type] || 0) + 1;
                    return acc;
                  },
                  { BENCH: 0, PAVILION: 0, SHADE_CANOPY: 0, PARK_FACILITY: 0 },
                );
                setSelectedClusterInfo({
                  name: marker.name,
                  count: marker.count,
                  counts: clusterCounts,
                  samplePoints: pts.slice(0, 4),
                });

                if (!mapRef.current) return;
                const pos = new maps.LatLng(marker.latitude, marker.longitude);
                const currentZoom =
                  typeof mapRef.current.getZoom === "function" ? mapRef.current.getZoom() : 14;
                const targetZoom = Math.max(currentZoom + 2, 17);
                if (typeof mapRef.current.setZoom === "function") {
                  mapRef.current.setZoom(targetZoom, true);
                }
                if (typeof mapRef.current.panTo === "function") {
                  mapRef.current.panTo(pos);
                } else if (typeof mapRef.current.setCenter === "function") {
                  mapRef.current.setCenter(pos);
                }
              }),
            );
          } else if (marker.kind === "RELIEF_POINT") {
            listenersRef.current.push(
              maps.Event.addListener(instance, "click", () => {
                setSelectedClusterInfo(null);
                setSelectedReliefPoint(marker);
                if (!mapRef.current) return;
                const pos = new maps.LatLng(marker.latitude, marker.longitude);
                if (typeof mapRef.current.panTo === "function") {
                  mapRef.current.panTo(pos);
                } else if (typeof mapRef.current.setCenter === "function") {
                  mapRef.current.setCenter(pos);
                }
              }),
            );
          }
        }
      }

      if (currentLocation) {
        const position = new maps.LatLng(currentLocation.latitude, currentLocation.longitude);
        bounds.extend(position);
        markersRef.current.push(
          new maps.Marker({
            map: mapRef.current,
            position,
            title: "출발 위치",
            icon: {
              content: startLocationMarkerContent(),
              anchor: { x: 17, y: 44 },
            },
          }),
        );
      }

      const currentFitKey = viewportFitKey(points, reliefPoints, currentLocation);
      if (fitKeyRef.current !== currentFitKey) {
        fitKeyRef.current = currentFitKey;
        if (
          clustered.length > 0 ||
          (showReliefPoints && clusteredRelief.length > 0) ||
          currentLocation
        ) {
          mapRef.current.fitBounds(bounds, 48);
        }
      }
    } catch {
      clearArtifacts();
      mapRef.current = null;
      setState("LOAD_FAILED");
      return;
    }

    return clearArtifacts;
  }, [
    clustered,
    clusteredRelief,
    currentLocation,
    onSelect,
    points,
    reliefPoints,
    selectedId,
    selectedReliefPoint?.id,
    showReliefPoints,
    state,
  ]);

  const errorMessage = STATE_MESSAGE[state];

  return (
    <section
      aria-label="폭염 안전시설 위치 지도"
      className="overflow-hidden rounded-xl border border-border bg-raised shadow-sh-1"
    >
      <div className="relative">
        <div
          ref={canvasRef}
          data-testid="naver-map-canvas"
          aria-hidden="true"
          className="h-[360px] w-full bg-[radial-gradient(circle_at_30%_35%,color-mix(in_oklab,var(--safe)_12%,transparent),transparent_32%),linear-gradient(145deg,var(--overlay),var(--raised))] lg:h-[620px]"
        />

        {reliefPoints.length > 0 ? (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-lg border border-border bg-overlay/95 p-1.5 shadow-sh-2 backdrop-blur-md">
            <button
              type="button"
              onClick={() => {
                setShowReliefPoints((prev) => !prev);
                setSelectedReliefPoint(null);
                setSelectedClusterInfo(null);
              }}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-bold transition-colors ${
                showReliefPoints
                  ? "bg-brand/15 text-brand hover:bg-brand/25"
                  : "bg-surface text-fg-3 hover:text-fg-1"
              }`}
              aria-pressed={showReliefPoints}
              aria-label="야외 폭염 안전시설 표시 전환"
            >
              <span
                className={`size-2 rounded-full ${showReliefPoints ? "bg-brand" : "bg-fg-3"}`}
              />
              야외 시설 {showReliefPoints ? "표시 중" : "숨김"}
            </button>
          </div>
        ) : null}

        {selectedClusterInfo ? (
          <div
            role="region"
            aria-label="폭염 안전시설 묶음 정보"
            className="absolute bottom-4 left-4 right-4 z-20 max-w-sm rounded-xl border border-border bg-overlay/95 p-4 shadow-sh-2 backdrop-blur-md transition-all sm:right-auto sm:w-80"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-0.5 text-[11px] font-bold text-white">
                시설 묶음 ({selectedClusterInfo.count}곳)
              </span>
              <button
                type="button"
                onClick={() => setSelectedClusterInfo(null)}
                className="rounded p-1 text-fg-3 hover:bg-surface hover:text-fg-1"
                aria-label="묶음 정보 닫기"
              >
                <svg
                  className="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <h4 className="t-body-s mt-2 font-bold text-fg-1">
              이 위치에 총 {selectedClusterInfo.count}개의 안전시설이 있습니다.
            </h4>

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-fg-2">
              {selectedClusterInfo.counts.SHADE_CANOPY > 0 ? (
                <span>그늘막 {selectedClusterInfo.counts.SHADE_CANOPY}</span>
              ) : null}
              {selectedClusterInfo.counts.BENCH > 0 ? (
                <span>벤치 {selectedClusterInfo.counts.BENCH}</span>
              ) : null}
              {selectedClusterInfo.counts.PAVILION > 0 ? (
                <span>정자 {selectedClusterInfo.counts.PAVILION}</span>
              ) : null}
              {selectedClusterInfo.counts.PARK_FACILITY > 0 ? (
                <span>공원시설 {selectedClusterInfo.counts.PARK_FACILITY}</span>
              ) : null}
            </div>

            {selectedClusterInfo.samplePoints.length > 0 ? (
              <ul className="mt-2 border-t border-border pt-2 text-[11px] text-fg-3 space-y-1">
                {selectedClusterInfo.samplePoints.map((pt) => (
                  <li key={pt.id} className="truncate">
                    • {pt.name} {pt.address ? `(${pt.address})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="t-caption mt-2.5 text-[11px] font-semibold text-brand">
              💡 지도를 최대로 확대하여 개별 마커를 확인하세요.
            </p>
          </div>
        ) : null}

        {selectedReliefPoint ? (
          <div
            role="region"
            aria-label="선택한 폭염 안전시설 정보"
            className="absolute bottom-4 left-4 right-4 z-20 max-w-sm rounded-xl border border-border bg-overlay/95 p-4 shadow-sh-2 backdrop-blur-md transition-all sm:right-auto sm:w-80"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                    RELIEF_TYPE_DETAILS[selectedReliefPoint.type].badgeClass
                  }`}
                >
                  {RELIEF_TYPE_DETAILS[selectedReliefPoint.type].label}
                </span>
                {selectedReliefPoint.distanceM !== undefined ? (
                  <span className="text-[12px] font-semibold text-fg-2">
                    약{" "}
                    {selectedReliefPoint.distanceM >= 1000
                      ? `${(selectedReliefPoint.distanceM / 1000).toFixed(1)}km`
                      : `${selectedReliefPoint.distanceM}m`}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setSelectedReliefPoint(null)}
                className="rounded p-1 text-fg-3 hover:bg-surface hover:text-fg-1"
                aria-label="시설 정보 닫기"
              >
                <svg
                  className="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <h4 className="t-body-s mt-2.5 font-bold text-fg-1">{selectedReliefPoint.name}</h4>

            {selectedReliefPoint.address || selectedReliefPoint.detail ? (
              <p className="t-caption mt-1 text-fg-2">
                {selectedReliefPoint.address ?? ""}
                {selectedReliefPoint.address && selectedReliefPoint.detail ? " · " : ""}
                {selectedReliefPoint.detail ?? ""}
              </p>
            ) : null}

            {selectedReliefPoint.district ? (
              <p className="t-caption mt-0.5 text-fg-3">지역: {selectedReliefPoint.district}</p>
            ) : null}

            <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[11px] text-fg-3">
              <span>출처: {formatHeatReliefSourceLabel(selectedReliefPoint.source)}</span>
              {selectedReliefPoint.condition ? (
                <span className="font-semibold text-brand">
                  상태: {selectedReliefPoint.condition}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {reliefPoints.length > 0 ? (
        <div className="border-t border-border bg-background px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="t-body-s font-bold">주변 폭염 안전시설 {reliefPoints.length}곳</p>
            <span className="t-caption text-[11px] text-fg-3">마커 클릭 시 상세 정보 및 확대</span>
          </div>
          <div
            className="t-caption mt-2 flex flex-wrap gap-x-4 gap-y-1 text-fg-2"
            aria-label="시설 종류별 개수"
          >
            {reliefCounts.SHADE_CANOPY > 0 ? <span>그늘막 {reliefCounts.SHADE_CANOPY}</span> : null}
            {reliefCounts.BENCH > 0 ? <span>벤치 {reliefCounts.BENCH}</span> : null}
            {reliefCounts.PAVILION > 0 ? <span>정자 {reliefCounts.PAVILION}</span> : null}
            {reliefCounts.PARK_FACILITY > 0 ? (
              <span>공원시설 {reliefCounts.PARK_FACILITY}</span>
            ) : null}
          </div>
          <p className="t-caption mt-2 text-fg-2">
            공공데이터·OpenStreetMap 위치 자료이며 당일 설치·운영 여부는 현장과 다를 수 있습니다.
          </p>
        </div>
      ) : null}
      {state === "LOADING" ? (
        <p className="t-body-s text-fg-2 border-t border-border p-4" role="status">
          지도를 불러오는 중입니다. 쉼터 목록은 먼저 이용할 수 있습니다.
        </p>
      ) : null}
      {errorMessage ? (
        <div className="border-t border-border p-4" role="status">
          <p className="t-body-s font-semibold">{errorMessage}</p>
          <p className="t-caption text-fg-2 mt-1">
            아래 쉼터 목록은 그대로 이용할 수 있습니다. 안전시설 범례도 함께 확인해 주세요.
          </p>
        </div>
      ) : null}
    </section>
  );
}
