import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShelterSearchResult } from "@/lib/shelters/service.server";
import type { DepartureComparisonUiDto, RoutePlanUiDto } from "@/components/routing";
import type { HeatReliefPointDto } from "@/lib/heat-relief/public-catalog";

import { ShelterExplorer } from "./ShelterExplorer";

const result: ShelterSearchResult = {
  query: {
    lat: 35.871,
    lng: 128.601,
    radius: 500,
    imBank: false,
    open: "ALL",
    sort: "priority",
    limit: 50,
  },
  shelters: [
    {
      id: "DG-0009",
      name: "iM뱅크 중구청지점",
      facilityType: "금융기관",
      gu: "중구",
      isImBank: true,
      roadAddress: "대구광역시 중구 국채보상로 139길 1",
      latitude: 35.8707,
      longitude: 128.6063,
      distanceM: 312,
      walkMin: 7,
      open: "OPEN",
      crowd: "SPARSE",
      lastReportAt: "2026-08-23T11:50:00.000Z",
      attest: "VERIFIED",
      attestUid: "0xabc",
    },
  ],
  emptyAction: { type: "NONE" },
};

const mapLoader = {
  getState: () => "READY" as const,
  subscribe: () => () => undefined,
  load: async () => undefined,
};

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  }
});

describe("ShelterExplorer", () => {
  it("renders the complete list content without requesting location on entry", () => {
    const requestLocation = vi.fn();
    render(
      <ShelterExplorer
        result={result}
        totalShelterCount={1234}
        originSource="DAEGU_CENTER"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={vi.fn()}
        searchAddress={async () => []}
        requestLocation={requestLocation}
        mapLoader={mapLoader}
      />,
    );

    expect(requestLocation).not.toHaveBeenCalled();
    expect(screen.getByText("대구 무더위쉼터 1,234곳")).toBeVisible();
    expect(screen.getByText("대구 중심 기준 · 내 위치가 아닙니다")).toBeVisible();
    expect(screen.queryByText("대구 무더위쉼터 950곳")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "대구광역시 D-데이터허브" })).toHaveAttribute(
      "href",
      "https://data.daegu.go.kr/open/data/dataView.do?dataSetId=DMI_0000084579&dataSetDetailId=DDI_0000084589&provdMethod=MAP",
    );
    expect(screen.getByText(/2020년 4월 13일 기준/)).toBeVisible();
    expect(screen.getByRole("link", { name: "전국그늘막쉼터표준데이터" })).toHaveAttribute(
      "href",
      "https://www.data.go.kr/data/15129447/standard.do",
    );
    expect(screen.getByRole("link", { name: "대구광역시 공원시설물정보API" })).toHaveAttribute(
      "href",
      "https://www.data.go.kr/data/15109600/openapi.do",
    );
    expect(screen.getByText(/공원시설 상태 기준일/)).toBeVisible();
    expect(screen.getByRole("article", { name: /iM뱅크 중구청지점/ })).toHaveTextContent(
      "대구광역시 중구 국채보상로 139길 1",
    );
    expect(screen.getByRole("link", { name: /운영상태 제보/ })).toHaveAttribute(
      "href",
      "/report/DG-0009",
    );
  });

  it("loads public heat-relief facilities automatically and filters them to the search radius", async () => {
    const facility = (id: string, latitude: number, longitude: number): HeatReliefPointDto => ({
      id,
      type: "SHADE_CANOPY",
      name: `그늘막 ${id}`,
      district: "중구",
      latitude,
      longitude,
      detail: null,
      address: null,
      source: "DAEGU_DISTRICT_CSV",
      datasetUpdatedAt: "2026-08-01",
    });
    render(
      <ShelterExplorer
        result={result}
        totalShelterCount={950}
        originSource="DAEGU_CENTER"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={vi.fn()}
        searchAddress={async () => []}
        loadHeatReliefPoints={async () => [
          facility("near", 35.8711, 128.6011),
          facility("far", 35.9, 128.7),
        ]}
        mapLoader={mapLoader}
      />,
    );

    expect(await screen.findByText("주변 폭염 안전시설 1곳")).toBeVisible();
    expect(screen.getByText("그늘막 1")).toBeVisible();
  });

  it("requests a server-computed route from the selected search origin and renders it", async () => {
    const requestRoute = vi.fn(async (): Promise<RoutePlanUiDto> => ({
      destinationName: "iM뱅크 중구청지점",
      afterSunset: false,
      shadowCalculatedAt: null,
      naverMapUrl: null,
      candidates: [
        {
          id: "route-1",
          label: "후보 1",
          distanceM: 520,
          spatialAnalysisAvailable: true,
          shadeRatio: 0.68,
          shadows: [],
          segments: [
            {
              id: "shade-1",
              exposure: "SHADE",
              distanceM: 520,
              coordinates: [
                [128.601, 35.871],
                [128.6063, 35.8707],
              ],
            },
          ],
          restSpots: [],
          warnings: [],
        },
      ],
    }));
    render(
      <ShelterExplorer
        result={result}
        totalShelterCount={950}
        originSource="SELECTED_LOCATION"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={vi.fn()}
        searchAddress={async () => []}
        requestRoute={requestRoute}
        mapLoader={mapLoader}
        routeMapLoader={mapLoader}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /iM뱅크 중구청지점 보행 경로 보기/ }));

    await waitFor(() =>
      expect(requestRoute).toHaveBeenCalledWith({
        shelterId: "DG-0009",
        latitude: 35.871,
        longitude: 128.601,
      }),
    );
    expect(await screen.findByRole("heading", { name: "보행 경로 후보" })).toBeVisible();
    expect(screen.getByRole("region", { name: "보행 경로 결과" })).toHaveFocus();
  });

  it("renders the recommended automatic departure and lets the user inspect another time", async () => {
    const routePlan: RoutePlanUiDto = {
      destinationName: "iM뱅크 중구청지점",
      afterSunset: false,
      shadowCalculatedAt: "2026-08-23T12:00:00.000Z",
      naverMapUrl: null,
      candidates: [
        {
          id: "route-1",
          label: "후보 1",
          distanceM: 520,
          spatialAnalysisAvailable: true,
          shadeRatio: 0.68,
          shadows: [],
          segments: [],
          restSpots: [],
          warnings: [],
        },
      ],
    };
    const labels = ["지금 출발", "30분 후", "1시간 후"] as const;
    const offsets = [0, 30, 60] as const;
    const comparison: DepartureComparisonUiDto = {
      recommendedOffsetMinutes: 60,
      forecastSource: "KMA_VILLAGE_FORECAST",
      slots: offsets.map((offsetMinutes, index) => ({
        offsetMinutes,
        label: labels[index]!,
        departureAt: new Date(
          Date.parse("2026-08-23T12:00:00.000Z") + offsetMinutes * 60_000,
        ).toISOString(),
        feelsLikeC: 36 - index,
        forecastAt: "2026-08-23T21:00:00+09:00",
        forecastInterpolated: offsetMinutes === 30,
        shadePercent: 50 + index * 8,
        directSunMinutes: 18 - index * 3,
        walkingMinutes: 12,
        additionalWalkingMinutes: 0,
        plan: routePlan,
      })),
    };
    const requestDepartureComparison = vi.fn(async () => comparison);
    render(
      <ShelterExplorer
        result={result}
        totalShelterCount={950}
        originSource="SELECTED_LOCATION"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={vi.fn()}
        searchAddress={async () => []}
        requestDepartureComparison={requestDepartureComparison}
        mapLoader={mapLoader}
        routeMapLoader={mapLoader}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /iM뱅크 중구청지점 보행 경로 보기/ }));

    expect(
      await screen.findByRole("heading", { name: "언제 출발하면 덜 더울까요?" }),
    ).toBeVisible();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const timeline = screen.getByRole("slider", { name: "출발 시각" });
    expect(timeline).toHaveValue("0");
    fireEvent.change(timeline, { target: { value: "15" } });
    expect(timeline).toHaveValue("15");
    expect(screen.getByText("그늘 54%")).toBeVisible();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });

  it("preserves every filter selected before the server result rerenders", () => {
    const onQueryChange = vi.fn();
    render(
      <ShelterExplorer
        result={result}
        totalShelterCount={950}
        originSource="DAEGU_CENTER"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={onQueryChange}
        searchAddress={async () => []}
        mapLoader={mapLoader}
      />,
    );

    fireEvent.change(screen.getByLabelText("반경"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("구·군"), { target: { value: "동구" } });
    fireEvent.change(screen.getByLabelText("운영 상태"), { target: { value: "UNKNOWN" } });
    fireEvent.change(screen.getByLabelText("정렬"), { target: { value: "distance" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "iM뱅크 쉼터만" }));

    expect(onQueryChange).toHaveBeenLastCalledWith({
      ...result.query,
      radius: 3000,
      gu: "동구",
      open: "UNKNOWN",
      sort: "distance",
      imBank: true,
    });
  });

  it("does not start a route from stale list data while filters are updating", () => {
    const requestRoute = vi.fn(async (): Promise<RoutePlanUiDto> => ({
      destinationName: "iM뱅크 중구청지점",
      afterSunset: false,
      shadowCalculatedAt: null,
      naverMapUrl: null,
      candidates: [],
    }));
    render(
      <ShelterExplorer
        result={result}
        totalShelterCount={950}
        originSource="DAEGU_CENTER"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={vi.fn()}
        searchAddress={async () => []}
        requestRoute={requestRoute}
        mapLoader={mapLoader}
      />,
    );

    fireEvent.change(screen.getByLabelText("반경"), { target: { value: "1000" } });

    const routeButton = screen.getByRole("button", { name: /보행 경로 보기/ });
    expect(screen.getByText("선택한 조건을 지도와 쉼터 목록에 적용하고 있습니다…")).toBeVisible();
    expect(routeButton).toBeDisabled();
    fireEvent.click(routeButton);
    expect(requestRoute).not.toHaveBeenCalled();
  });

  it("removes a route computed for an old result when filters finish updating", async () => {
    const requestRoute = vi.fn(async (): Promise<RoutePlanUiDto> => ({
      destinationName: "iM뱅크 중구청지점",
      afterSunset: false,
      shadowCalculatedAt: null,
      naverMapUrl: null,
      candidates: [
        {
          id: "route-1",
          label: "후보 1",
          distanceM: 520,
          spatialAnalysisAvailable: true,
          shadeRatio: 0.68,
          shadows: [],
          segments: [],
          restSpots: [],
          warnings: [],
        },
      ],
    }));
    const props = {
      totalShelterCount: 950,
      originSource: "DAEGU_CENTER" as const,
      now: "2026-08-23T12:00:00.000Z",
      onQueryChange: vi.fn(),
      searchAddress: async () => [],
      requestRoute,
      mapLoader,
      routeMapLoader: mapLoader,
    };
    const view = render(<ShelterExplorer {...props} result={result} />);

    fireEvent.click(screen.getByRole("button", { name: /보행 경로 보기/ }));
    expect(await screen.findByRole("heading", { name: "보행 경로 후보" })).toBeVisible();

    view.rerender(
      <ShelterExplorer
        {...props}
        result={{
          query: { ...result.query, radius: 1000 },
          shelters: [],
          emptyAction: { type: "NO_RESULTS" },
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "보행 경로 후보" })).not.toBeInTheDocument(),
    );
  });

  it("shows an authenticated check-in as pending without applying HRI mitigation", async () => {
    const requestRoute = vi.fn(async (): Promise<RoutePlanUiDto> => ({
      destinationName: "iM뱅크 중구청지점",
      afterSunset: false,
      shadowCalculatedAt: null,
      naverMapUrl: null,
      candidates: [
        {
          id: "route-1",
          label: "후보 1",
          distanceM: 520,
          spatialAnalysisAvailable: true,
          shadeRatio: 0.68,
          shadows: [],
          segments: [],
          restSpots: [],
          warnings: [],
        },
      ],
    }));
    const requestCheckIn = vi.fn(async () => ({
      checkInId: "a3000000-0000-4000-8000-000000000001",
      attestationState: "PENDING" as const,
      displayStatus: "기록 확인 중" as const,
      contribution: 0 as const,
    }));
    render(
      <ShelterExplorer
        result={result}
        totalShelterCount={950}
        originSource="SUBJECT_LOCATION"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={vi.fn()}
        searchAddress={async () => []}
        requestRoute={requestRoute}
        requestCheckIn={requestCheckIn}
        createClientRequestId={() => "a2000000-0000-4000-8000-000000000001"}
        mapLoader={mapLoader}
        routeMapLoader={mapLoader}
        subjectScoped
      />,
    );

    expect(screen.queryByRole("button", { name: "내 위치로 찾기" })).not.toBeInTheDocument();
    expect(screen.getByText("등록된 대상자 위치 기준")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /보행 경로 보기/ }));
    await screen.findByRole("heading", { name: "보행 경로 후보" });
    fireEvent.click(screen.getByRole("button", { name: "도착 체크인" }));

    await waitFor(() =>
      expect(requestCheckIn).toHaveBeenCalledWith({
        shelterId: "DG-0009",
        clientRequestId: "a2000000-0000-4000-8000-000000000001",
      }),
    );
    expect(await screen.findByText("기록 확인 중 · Base Sepolia 테스트넷")).toBeVisible();
    expect(screen.getByText(/현재 HRI 완화 점수는 0점/)).toBeVisible();
  });

  it("requests browser location only after the explicit action and updates URL query values", async () => {
    const onQueryChange = vi.fn();
    const requestLocation = vi.fn(async () => ({
      kind: "SUCCESS" as const,
      latitude: 35.88,
      longitude: 128.62,
    }));
    render(
      <ShelterExplorer
        result={result}
        totalShelterCount={950}
        originSource="SELECTED_LOCATION"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={onQueryChange}
        searchAddress={async () => []}
        requestLocation={requestLocation}
        mapLoader={mapLoader}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "내 위치로 찾기" }));

    await waitFor(() => expect(requestLocation).toHaveBeenCalledOnce());
    expect(onQueryChange).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 35.88, lng: 128.62, radius: 500 }),
    );
  });

  it("falls back to server address candidates after denial", async () => {
    const onQueryChange = vi.fn();
    render(
      <ShelterExplorer
        result={result}
        totalShelterCount={null}
        originSource="DAEGU_CENTER"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={onQueryChange}
        requestLocation={async () => ({ kind: "DENIED" })}
        searchAddress={async () => [
          {
            label: "대구광역시 중구 국채보상로 670",
            roadAddress: "대구광역시 중구 국채보상로 670",
            jibunAddress: "",
            gu: "중구",
            latitude: 35.871,
            longitude: 128.601,
          },
        ]}
        mapLoader={mapLoader}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "내 위치로 찾기" }));
    expect(await screen.findByText(/주소로 검색해 주세요/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("대구 주소 검색"), {
      target: { value: "대구 중구청" },
    });
    fireEvent.click(screen.getByRole("button", { name: "주소 검색" }));
    fireEvent.click(await screen.findByRole("button", { name: /국채보상로 670 선택/ }));

    expect(onQueryChange).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 35.871, lng: 128.601 }),
    );
    expect(screen.getByText("쉼터 적재 건수 확인 지연")).toBeVisible();
  });

  it("resets origin coordinates and clears start location when district filter changes", async () => {
    const onQueryChange = vi.fn();
    render(
      <ShelterExplorer
        result={result}
        totalShelterCount={950}
        originSource="SELECTED_LOCATION"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={onQueryChange}
        searchAddress={async () => [
          {
            label: "대구광역시 중구 국채보상로 670",
            roadAddress: "대구광역시 중구 국채보상로 670",
            jibunAddress: "",
            gu: "중구",
            latitude: 35.871,
            longitude: 128.601,
          },
        ]}
        mapLoader={mapLoader}
      />,
    );

    // 1. 주소 검색으로 특정 위치 선택
    fireEvent.change(screen.getByLabelText("대구 주소 검색"), {
      target: { value: "대구 중구청" },
    });
    fireEvent.click(screen.getByRole("button", { name: "주소 검색" }));
    fireEvent.click(await screen.findByRole("button", { name: /국채보상로 670 선택/ }));

    // 2. 구·군 필터를 "수성구"로 변경
    fireEvent.change(screen.getByLabelText("구·군"), { target: { value: "수성구" } });

    // 3. 출발 좌표가 기본 좌표로 리셋되고 수성구로 필터링되는지 검증
    expect(onQueryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lat: 35.8714,
        lng: 128.6014,
        gu: "수성구",
      }),
    );
  });

  it("renders district-specific empty state message when shelters are not found for a district", () => {
    render(
      <ShelterExplorer
        result={{
          query: { ...result.query, gu: "달성군" },
          shelters: [],
          emptyAction: { type: "RESET_FILTERS" },
        }}
        totalShelterCount={950}
        originSource="DAEGU_CENTER"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={vi.fn()}
        searchAddress={async () => []}
        mapLoader={mapLoader}
      />,
    );

    expect(screen.getByText("해당 지역에 등록된 쉼터가 없습니다.")).toBeVisible();
    expect(screen.getByRole("button", { name: "필터 초기화" })).toBeVisible();
  });

  it("re-scopes public heat-relief facilities to the selected district", async () => {
    const facility = (
      id: string,
      latitude: number,
      longitude: number,
      district: string | null,
    ): HeatReliefPointDto => ({
      id,
      type: district === null ? "BENCH" : "SHADE_CANOPY",
      name: `안전시설 ${id}`,
      district,
      latitude,
      longitude,
      detail: null,
      address: null,
      source: district === null ? "OPENSTREETMAP" : "DAEGU_DISTRICT_CSV",
      datasetUpdatedAt: null,
    });
    const points = [
      facility("junggu-shade", 35.8711, 128.6011, "중구"),
      facility("suseong-shade", 35.858, 128.63, "수성구"),
      facility("suseong-bench", 35.8575, 128.631, null),
    ];
    const districtResult: ShelterSearchResult = {
      query: { ...result.query, lat: 35.8714, lng: 128.6014, gu: "수성구" },
      shelters: [
        {
          ...result.shelters[0]!,
          id: "DG-0301",
          name: "수성구민운동장 쉼터",
          gu: "수성구",
          latitude: 35.858,
          longitude: 128.63,
        },
      ],
      emptyAction: { type: "NONE" },
    };

    const { rerender } = render(
      <ShelterExplorer
        result={{ ...result, query: { ...result.query, lat: 35.8714, lng: 128.6014 } }}
        totalShelterCount={950}
        originSource="DAEGU_CENTER"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={vi.fn()}
        searchAddress={async () => []}
        loadHeatReliefPoints={async () => points}
        mapLoader={mapLoader}
      />,
    );
    expect(await screen.findByText("주변 폭염 안전시설 1곳")).toBeVisible();

    rerender(
      <ShelterExplorer
        result={districtResult}
        totalShelterCount={950}
        originSource="DAEGU_CENTER"
        now="2026-08-23T12:00:00.000Z"
        onQueryChange={vi.fn()}
        searchAddress={async () => []}
        loadHeatReliefPoints={async () => points}
        mapLoader={mapLoader}
      />,
    );

    expect(await screen.findByText("주변 폭염 안전시설 2곳")).toBeVisible();
    expect(screen.getByText("그늘막 1")).toBeVisible();
    expect(screen.getByText("벤치 1")).toBeVisible();
  });
});
