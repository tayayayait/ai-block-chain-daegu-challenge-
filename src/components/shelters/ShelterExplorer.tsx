import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DepartureTimeComparison,
  RouteExperience,
  type DepartureComparisonUiDto,
  type NaverRouteMapsLoaderPort,
  type RoutePlanUiDto,
} from "@/components/routing";
import type { NaverAddressCandidate } from "@/integrations/naver/geocode.server";
import {
  findNearbyHeatReliefPoints,
  loadHeatReliefCatalog,
  type HeatReliefPointDto,
  type NearbyHeatReliefPointDto,
} from "@/lib/heat-relief/public-catalog";
import { heatReliefSearchArea } from "@/lib/heat-relief/search-area";
import {
  requestCurrentLocation,
  type CurrentLocationResult,
} from "@/lib/geolocation/location-permission";
import {
  DEFAULT_PUBLIC_SHELTER_ORIGIN,
  type ShelterOriginSource,
  type ShelterSearchQuery,
} from "@/lib/shelters/search-schema";
import type { ShelterSearchResult } from "@/lib/shelters/service.server";
import type { PublicShelterDto } from "@/lib/shelters/public-dto";

import { NaverShelterMap, type NaverMapsLoaderPort } from "./NaverShelterMap";
import { ShelterFilters } from "./ShelterFilters";
import { ShelterLocationSearch } from "./ShelterLocationSearch";
import { ShelterResultsList } from "./ShelterResultsList";

export type ShelterCheckInUiResult = Readonly<{
  checkInId: string;
  attestationState: "PENDING";
  displayStatus: "기록 확인 중";
  contribution: 0;
}>;

type CheckInState =
  | Readonly<{ kind: "IDLE" }>
  | Readonly<{ kind: "SUBMITTING" }>
  | Readonly<{ kind: "PENDING" }>
  | Readonly<{ kind: "ERROR" }>;

const SHELTER_ORIGIN_LABEL: Readonly<Record<ShelterOriginSource, string>> = Object.freeze({
  DAEGU_CENTER: "대구 중심 기준 · 내 위치가 아닙니다",
  SELECTED_LOCATION: "선택한 위치 기준",
  SUBJECT_LOCATION: "등록된 대상자 위치 기준",
  ALERT_SUBJECT_LOCATION: "알림 대상자 위치 기준",
});

function sameShelterQuery(left: ShelterSearchQuery, right: ShelterSearchQuery): boolean {
  return (
    left.lat === right.lat &&
    left.lng === right.lng &&
    left.radius === right.radius &&
    left.gu === right.gu &&
    left.imBank === right.imBank &&
    left.open === right.open &&
    left.sort === right.sort &&
    left.limit === right.limit
  );
}

async function loadDefaultHeatReliefPoints(): Promise<readonly HeatReliefPointDto[]> {
  return (await loadHeatReliefCatalog()).points;
}

export const ShelterExplorer = ({
  result,
  totalShelterCount,
  originSource,
  now,
  onQueryChange,
  searchAddress,
  requestLocation = () => requestCurrentLocation({}),
  loadHeatReliefPoints = loadDefaultHeatReliefPoints,
  mapLoader,
  requestRoute,
  requestDepartureComparison,
  routeMapLoader,
  requestCheckIn,
  createClientRequestId = () => globalThis.crypto.randomUUID(),
  subjectScoped = false,
}: {
  result: ShelterSearchResult;
  totalShelterCount: number | null;
  originSource: ShelterOriginSource;
  now: string;
  onQueryChange: (query: ShelterSearchQuery) => void;
  searchAddress: (query: string) => Promise<readonly NaverAddressCandidate[]>;
  requestLocation?: () => Promise<CurrentLocationResult>;
  loadHeatReliefPoints?: () => Promise<readonly HeatReliefPointDto[]>;
  mapLoader?: NaverMapsLoaderPort;
  requestRoute?: (input: {
    shelterId: string;
    latitude: number;
    longitude: number;
  }) => Promise<RoutePlanUiDto>;
  requestDepartureComparison?: (input: {
    shelterId: string;
    latitude: number;
    longitude: number;
  }) => Promise<DepartureComparisonUiDto>;
  routeMapLoader?: NaverRouteMapsLoaderPort;
  requestCheckIn?: (input: {
    shelterId: string;
    clientRequestId: string;
  }) => Promise<ShelterCheckInUiResult>;
  createClientRequestId?: () => string;
  subjectScoped?: boolean;
}) => {
  const { query, shelters, emptyAction } = result;
  const filterQueryRef = useRef(query);
  const pendingQueryRef = useRef<ShelterSearchQuery | null>(null);
  const routeRequestIdRef = useRef(0);
  const routeResultRef = useRef<HTMLElement>(null);
  const [filterQuery, setFilterQuery] = useState(query);
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [heatReliefPoints, setHeatReliefPoints] = useState<readonly NearbyHeatReliefPointDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [routePlan, setRoutePlan] = useState<RoutePlanUiDto | null>(null);
  const [departureComparison, setDepartureComparison] = useState<DepartureComparisonUiDto | null>(
    null,
  );
  const [selectedDepartureOffset, setSelectedDepartureOffset] = useState<number | null>(null);
  const [routeShelterId, setRouteShelterId] = useState<string | null>(null);
  const [routeLoadingId, setRouteLoadingId] = useState<string | null>(null);
  const [routeError, setRouteError] = useState(false);
  const [checkInState, setCheckInState] = useState<CheckInState>({ kind: "IDLE" });

  const clearRouteState = useCallback(() => {
    routeRequestIdRef.current += 1;
    setSelectedId(null);
    setRoutePlan(null);
    setDepartureComparison(null);
    setSelectedDepartureOffset(null);
    setRouteShelterId(null);
    setRouteLoadingId(null);
    setRouteError(false);
    setCheckInState({ kind: "IDLE" });
  }, []);

  useEffect(() => {
    const pendingQuery = pendingQueryRef.current;
    if (pendingQuery === null || sameShelterQuery(query, pendingQuery)) {
      pendingQueryRef.current = null;
      filterQueryRef.current = query;
      setFilterQuery(query);
    }
    clearRouteState();
  }, [clearRouteState, query]);

  const {
    latitude: reliefLatitude,
    longitude: reliefLongitude,
    radiusM: reliefRadiusM,
    district: reliefDistrict,
  } = useMemo(() => heatReliefSearchArea(query, shelters), [query, shelters]);

  useEffect(() => {
    let cancelled = false;
    void loadHeatReliefPoints()
      .then((points) => {
        if (cancelled) return;
        setHeatReliefPoints(
          findNearbyHeatReliefPoints(points, {
            latitude: reliefLatitude,
            longitude: reliefLongitude,
            radiusM: reliefRadiusM,
            district: reliefDistrict,
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setHeatReliefPoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadHeatReliefPoints, reliefLatitude, reliefLongitude, reliefRadiusM, reliefDistrict]);

  const routeResultVisible = routePlan !== null || routeError;

  useEffect(() => {
    if (!routeResultVisible) return;
    routeResultRef.current?.focus({ preventScroll: true });
    routeResultRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [routeResultVisible]);

  const commitQuery = (nextQuery: ShelterSearchQuery) => {
    pendingQueryRef.current = nextQuery;
    filterQueryRef.current = nextQuery;
    setFilterQuery(nextQuery);
    clearRouteState();
    onQueryChange(nextQuery);
  };
  const changeQuery = (patch: Partial<ShelterSearchQuery>) =>
    commitQuery({ ...filterQueryRef.current, ...patch });
  const filtersPending = !sameShelterQuery(filterQuery, query);

  const chooseLocation = (location: { latitude: number; longitude: number }) => {
    setCurrentLocation(location);
    changeQuery({ lat: location.latitude, lng: location.longitude, radius: 500 });
  };

  const requestShelterRoute = async (shelter: PublicShelterDto) => {
    if ((!requestRoute && !requestDepartureComparison) || routeLoadingId !== null) return;
    const requestId = routeRequestIdRef.current + 1;
    routeRequestIdRef.current = requestId;
    setSelectedId(shelter.id);
    setRouteLoadingId(shelter.id);
    setRouteError(false);
    setRoutePlan(null);
    setDepartureComparison(null);
    setSelectedDepartureOffset(null);
    setRouteShelterId(null);
    setCheckInState({ kind: "IDLE" });
    try {
      const requestInput = {
        shelterId: shelter.id,
        latitude: query.lat,
        longitude: query.lng,
      };
      const nextComparison = requestDepartureComparison
        ? await requestDepartureComparison(requestInput)
        : null;
      const initialDepartureSlot = nextComparison?.slots.find((slot) => slot.offsetMinutes === 0);
      const nextPlan = nextComparison
        ? (initialDepartureSlot?.plan ?? nextComparison.slots[0]?.plan ?? null)
        : requestRoute
          ? await requestRoute(requestInput)
          : null;
      if (nextPlan === null) throw new Error("Recommended departure route is missing.");
      if (routeRequestIdRef.current !== requestId) return;
      setRoutePlan(nextPlan);
      setDepartureComparison(nextComparison);
      setSelectedDepartureOffset(
        nextComparison ? (initialDepartureSlot?.offsetMinutes ?? 0) : null,
      );
      setRouteShelterId(shelter.id);
    } catch {
      if (routeRequestIdRef.current !== requestId) return;
      setRouteError(true);
    } finally {
      if (routeRequestIdRef.current === requestId) setRouteLoadingId(null);
    }
  };

  const submitCheckIn = async () => {
    if (
      !requestCheckIn ||
      !routeShelterId ||
      checkInState.kind === "SUBMITTING" ||
      checkInState.kind === "PENDING"
    )
      return;
    setCheckInState({ kind: "SUBMITTING" });
    try {
      const result = await requestCheckIn({
        shelterId: routeShelterId,
        clientRequestId: createClientRequestId(),
      });
      setCheckInState(
        result.attestationState === "PENDING" &&
          result.displayStatus === "기록 확인 중" &&
          result.contribution === 0
          ? { kind: "PENDING" }
          : { kind: "ERROR" },
      );
    } catch {
      setCheckInState({ kind: "ERROR" });
    }
  };

  const handleFiltersChange = (nextQuery: ShelterSearchQuery) => {
    if (nextQuery.gu !== filterQueryRef.current.gu) {
      setCurrentLocation(null);
      if (currentLocation !== null) {
        commitQuery({
          ...nextQuery,
          lat: DEFAULT_PUBLIC_SHELTER_ORIGIN.lat,
          lng: DEFAULT_PUBLIC_SHELTER_ORIGIN.lng,
        });
        return;
      }
    }
    commitQuery(nextQuery);
  };

  return (
    <main className="pb-12">
      <header className="pt-3">
        <p className="t-caption font-bold" style={{ color: "var(--brand)" }}>
          {totalShelterCount === null
            ? "쉼터 적재 건수 확인 지연"
            : `대구 무더위쉼터 ${new Intl.NumberFormat("ko-KR").format(totalShelterCount)}곳`}
        </p>
        <p className="t-caption text-fg-2 mt-2">{SHELTER_ORIGIN_LABEL[originSource]}</p>
        <h1 className="t-d1 mt-2">가까운 쉼터 찾기</h1>
        <p className="t-body-s text-fg-2 mt-3">
          지도 없이도 아래 목록에서 운영 상태와 거리, iM뱅크 쉼터를 확인할 수 있습니다.
        </p>
        <p className="t-caption text-fg-2 mt-2">
          위치 원본:{" "}
          <a
            href="https://data.daegu.go.kr/open/data/dataView.do?dataSetId=DMI_0000084579&dataSetDetailId=DDI_0000084589&provdMethod=MAP"
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            대구광역시 D-데이터허브
          </a>{" "}
          · 2020년 4월 13일 기준 위치입니다. 최신 운영 여부는 이용자 제보가 없으면 미확인으로
          표시합니다.
        </p>
        <p className="t-caption text-fg-2 mt-2">
          안전시설 원본:{" "}
          <a
            href="https://www.data.go.kr/data/15129447/standard.do"
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            전국그늘막쉼터표준데이터
          </a>{" "}
          · 대구 구·군 갱신자료 ·{" "}
          <a
            href="https://www.data.go.kr/data/15109600/openapi.do"
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            대구광역시 공원시설물정보API
          </a>{" "}
          ·{" "}
          <a
            href="https://www.openstreetmap.org/relation/2395674"
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            OpenStreetMap 벤치·정자
          </a>{" "}
          · 공원시설 상태 기준일은 제공 항목별로 다르며 오래된 항목은 현장 확인이 필요합니다.
        </p>
      </header>

      {subjectScoped ? (
        <div className="border-border bg-raised t-body-s mt-5 rounded-xl border p-4" role="status">
          권한이 확인된 대상자 위치를 출발점으로 사용합니다. 주소와 좌표는 URL에 저장하지 않습니다.
        </div>
      ) : (
        <ShelterLocationSearch
          key={query.gu ?? "all"}
          searchAddress={searchAddress}
          requestLocation={requestLocation}
          onChooseLocation={chooseLocation}
        />
      )}
      <ShelterFilters query={filterQuery} onChange={handleFiltersChange} />

      {filtersPending ? (
        <p className="t-body-s mt-4 font-semibold text-fg-2" role="status" aria-live="polite">
          선택한 조건을 지도와 쉼터 목록에 적용하고 있습니다…
        </p>
      ) : null}

      <div
        className="mt-6 grid gap-5 transition-opacity lg:grid-cols-12"
        aria-busy={filtersPending}
      >
        <div className="order-2 lg:order-1 lg:col-span-7 lg:sticky lg:top-4 lg:self-start">
          <NaverShelterMap
            points={shelters.map((shelter) => ({
              id: shelter.id,
              name: shelter.name,
              latitude: shelter.latitude,
              longitude: shelter.longitude,
              open: shelter.open,
              isImBank: shelter.isImBank,
            }))}
            reliefPoints={heatReliefPoints}
            currentLocation={currentLocation}
            selectedId={selectedId}
            onSelect={setSelectedId}
            {...(mapLoader === undefined ? {} : { loader: mapLoader })}
          />
        </div>
        <ShelterResultsList
          shelters={shelters}
          now={now}
          query={query}
          emptyAction={emptyAction}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onQueryChange={commitQuery}
          updating={filtersPending}
          {...(requestRoute === undefined && requestDepartureComparison === undefined
            ? {}
            : { onRequestRoute: requestShelterRoute, routeLoadingId })}
        />
      </div>

      {routeLoadingId !== null || routeError || routePlan ? (
        <section
          ref={routeResultRef}
          aria-label="보행 경로 결과"
          aria-busy={routeLoadingId !== null}
          className="mt-8 scroll-mt-4 outline-none"
          tabIndex={-1}
        >
          {routeLoadingId !== null ? (
            <p className="t-body-s font-semibold text-fg-2" role="status">
              그늘과 접근성 자료를 반영해 경로 후보를 계산하고 있습니다…
            </p>
          ) : null}
          {routeError ? (
            <div className="rounded-xl border border-danger/40 bg-raised p-5" role="alert">
              <p className="t-body-s font-bold">경로를 불러오지 못했습니다.</p>
              <p className="t-caption mt-1 text-fg-2">
                잠시 후 같은 쉼터의 경로를 다시 요청해 주세요.
              </p>
            </div>
          ) : null}
          {routePlan ? (
            <div>
              {departureComparison && selectedDepartureOffset !== null ? (
                <div className="mb-6">
                  <DepartureTimeComparison
                    comparison={departureComparison}
                    selectedOffsetMinutes={selectedDepartureOffset}
                    onSelect={(offsetMinutes, plan) => {
                      setSelectedDepartureOffset(offsetMinutes);
                      setRoutePlan(plan);
                    }}
                  />
                </div>
              ) : null}
              <RouteExperience
                plan={routePlan}
                {...(routeMapLoader === undefined ? {} : { mapLoader: routeMapLoader })}
              />
              {requestCheckIn && routeShelterId ? (
                <section className="border-border bg-raised mt-5 rounded-xl border p-5">
                  <h2 className="t-h3">도착 기록</h2>
                  <p className="t-caption mt-2 text-fg-2">
                    현장 도착 후 체크인하세요. 온체인 검증 전에는 위험도 완화에 반영되지 않습니다.
                  </p>
                  {checkInState.kind === "PENDING" ? (
                    <div className="mt-4" role="status" aria-live="polite">
                      <p className="t-body-s font-bold">기록 확인 중 · Base Sepolia 테스트넷</p>
                      <p className="t-caption mt-1 text-fg-2">
                        현재 HRI 완화 점수는 0점입니다. 증명이 VERIFIED가 된 뒤 다음 계산부터 6점이
                        차감됩니다.
                      </p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary mt-4 min-h-[var(--tap-min)] w-full px-5"
                      disabled={checkInState.kind === "SUBMITTING"}
                      onClick={() => void submitCheckIn()}
                    >
                      {checkInState.kind === "SUBMITTING" ? "체크인 저장 중…" : "도착 체크인"}
                    </button>
                  )}
                  {checkInState.kind === "ERROR" ? (
                    <p className="t-caption mt-3 text-danger" role="alert">
                      체크인을 저장하지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요.
                    </p>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
};
