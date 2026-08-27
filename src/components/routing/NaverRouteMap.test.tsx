import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NaverMapsLoadState } from "@/lib/naver/maps-loader";

import { NaverRouteMap, ROUTE_STROKES } from "./NaverRouteMap";
import type { RouteCandidateUiDto } from "./route-ui-dto";

const selected: RouteCandidateUiDto = {
  id: "route-a",
  label: "후보 1",
  distanceM: 500,
  spatialAnalysisAvailable: true,
  shadeRatio: 0.7,
  shadows: [
    {
      type: "Polygon",
      coordinates: [
        [
          [128.6, 35.87],
          [128.603, 35.87],
          [128.603, 35.871],
          [128.6, 35.87],
        ],
      ],
    },
  ],
  segments: [
    {
      id: "shade",
      exposure: "SHADE",
      distanceM: 350,
      coordinates: [
        [128.6, 35.87],
        [128.603, 35.871],
      ],
    },
    {
      id: "sun",
      exposure: "SUN",
      distanceM: 150,
      coordinates: [
        [128.603, 35.871],
        [128.606, 35.872],
      ],
    },
  ],
  restSpots: [],
  warnings: [],
};

const alternative: RouteCandidateUiDto = {
  ...selected,
  id: "route-b",
  label: "후보 2",
  segments: [
    {
      id: "alt",
      exposure: "SUN",
      distanceM: 560,
      coordinates: [
        [128.6, 35.87],
        [128.608, 35.874],
      ],
    },
  ],
};

afterEach(() => {
  delete (window as Window & { naver?: unknown }).naver;
});

describe("NaverRouteMap", () => {
  it("defines exact selected and alternative route stroke contracts", () => {
    expect(ROUTE_STROKES.SHADE).toMatchObject({
      strokeColor: "#0b6e6b",
      strokeWeight: 6,
      strokeStyle: "solid",
    });
    expect(ROUTE_STROKES.SUN).toMatchObject({
      strokeColor: "#d2601a",
      strokeWeight: 6,
      strokeStyle: "solid",
    });
    expect(ROUTE_STROKES.ALTERNATIVE).toMatchObject({
      strokeColor: "#7a8c93",
      strokeWeight: 4,
      strokeStyle: "shortdash",
    });
  });

  it("draws alternatives first and selected shade/sun segments above them", async () => {
    const polylineOptions: Record<string, unknown>[] = [];
    const polygonOptions: Record<string, unknown>[] = [];
    const drawOrder: string[] = [];
    const setMap = vi.fn();
    class MapMock {
      fitBounds = vi.fn();
    }
    class LatLngMock {
      constructor(
        readonly latitude: number,
        readonly longitude: number,
      ) {}
    }
    class BoundsMock {
      extend = vi.fn();
    }
    class PolylineMock {
      constructor(options: Record<string, unknown>) {
        polylineOptions.push(options);
        drawOrder.push(`line-${String(options["zIndex"])}`);
      }
      setMap = setMap;
    }
    class PolygonMock {
      constructor(options: Record<string, unknown>) {
        polygonOptions.push(options);
        drawOrder.push(`polygon-${String(options["zIndex"])}`);
      }
      setMap = setMap;
    }
    const markerOptions: Record<string, unknown>[] = [];
    class MarkerMock {
      constructor(options: Record<string, unknown>) {
        markerOptions.push(options);
        drawOrder.push(`marker-${String(options["zIndex"])}`);
      }
      setMap = setMap;
    }
    (window as Window & { naver?: unknown }).naver = {
      maps: {
        Map: MapMock,
        LatLng: LatLngMock,
        LatLngBounds: BoundsMock,
        Polyline: PolylineMock,
        Polygon: PolygonMock,
        Marker: MarkerMock,
      },
    };
    const loader = {
      getState: () => "READY" as const,
      subscribe: () => () => undefined,
      load: () => Promise.resolve(),
    };

    render(
      <NaverRouteMap
        selected={selected}
        alternatives={[alternative]}
        loader={loader}
        shadowCalculatedAt="2026-08-24T03:00:00.000Z"
      />,
    );

    await waitFor(() => expect(polylineOptions).toHaveLength(5));
    expect(polygonOptions).toHaveLength(1);
    expect(polygonOptions[0]).toMatchObject({
      fillColor: "#1e293b",
      fillOpacity: 0.1,
      strokeWeight: 0,
      clickable: false,
    });
    expect(markerOptions).toHaveLength(2);
    expect(markerOptions[0]).toMatchObject({
      title: "출발 위치",
      zIndex: 100,
    });
    expect(markerOptions[1]).toMatchObject({
      title: "도착 위치",
      zIndex: 100,
    });
    expect(drawOrder).toEqual([
      "line-10",
      "polygon-15",
      "line-25",
      "line-25",
      "line-30",
      "line-30",
      "marker-100",
      "marker-100",
    ]);
    expect(polylineOptions.map(({ strokeWeight }) => strokeWeight)).toEqual([4, 10, 10, 6, 6]);
    expect(polylineOptions.map(({ strokeColor }) => strokeColor)).toEqual([
      "#7a8c93",
      "#ffffff",
      "#ffffff",
      "#0b6e6b",
      "#d2601a",
    ]);
    expect(screen.getByText("시간 그림자")).toBeInTheDocument();
    expect(screen.getByText(/8월 24일.*오후 12:00 기준/u)).toBeInTheDocument();
    expect(screen.getByText("건물 예상 그림자")).toBeInTheDocument();
    expect(screen.getByText(/건물 높이.*태양 위치로 계산한 예상 그림자/u)).toBeInTheDocument();
  });

  it("updates moving shadow paths without rebuilding the route or refitting the map", async () => {
    const mapInstances: MapMock[] = [];
    const polylineOptions: Record<string, unknown>[] = [];
    const polygonOptions: Record<string, unknown>[] = [];
    const setShadowPaths = vi.fn();

    class MapMock {
      fitBounds = vi.fn();

      constructor() {
        mapInstances.push(this);
      }
    }
    class LatLngMock {
      constructor(
        readonly latitude: number,
        readonly longitude: number,
      ) {}
    }
    class BoundsMock {
      extend = vi.fn();
    }
    class PolylineMock {
      constructor(options: Record<string, unknown>) {
        polylineOptions.push(options);
      }
      setMap = vi.fn();
    }
    class PolygonMock {
      constructor(options: Record<string, unknown>) {
        polygonOptions.push(options);
      }
      setMap = vi.fn();
      setPaths = setShadowPaths;
    }
    class MarkerMock {
      setMap = vi.fn();
    }
    (window as Window & { naver?: unknown }).naver = {
      maps: {
        Map: MapMock,
        LatLng: LatLngMock,
        LatLngBounds: BoundsMock,
        Polyline: PolylineMock,
        Polygon: PolygonMock,
        Marker: MarkerMock,
      },
    };
    const loader = {
      getState: () => "READY" as const,
      subscribe: () => () => undefined,
      load: () => Promise.resolve(),
    };
    const { rerender } = render(
      <NaverRouteMap
        selected={selected}
        alternatives={[]}
        loader={loader}
        shadowCalculatedAt="2026-08-24T03:00:00.000Z"
      />,
    );

    await waitFor(() => expect(polylineOptions).toHaveLength(4));
    expect(mapInstances[0]?.fitBounds).toHaveBeenCalledTimes(1);
    expect(polygonOptions).toHaveLength(1);

    const movedShadow: RouteCandidateUiDto = {
      ...selected,
      shadows: [
        {
          type: "Polygon",
          coordinates: [
            [
              [128.601, 35.871],
              [128.604, 35.871],
              [128.604, 35.872],
              [128.601, 35.871],
            ],
          ],
        },
      ],
    };
    rerender(
      <NaverRouteMap
        selected={movedShadow}
        alternatives={[]}
        loader={loader}
        shadowCalculatedAt="2026-08-24T03:00:06.000Z"
      />,
    );

    await waitFor(() => expect(setShadowPaths).toHaveBeenCalledTimes(1));
    expect(polylineOptions).toHaveLength(4);
    expect(polygonOptions).toHaveLength(1);
    expect(mapInstances[0]?.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("keeps a textual segment list available when map authentication fails", async () => {
    let listener: ((state: NaverMapsLoadState) => void) | undefined;
    const loader = {
      getState: () => "IDLE" as const,
      subscribe: (next: (state: NaverMapsLoadState) => void) => {
        listener = next;
        return () => undefined;
      },
      load: async () => {
        listener?.("AUTH_FAILED");
        throw new Error("safe");
      },
    };

    render(<NaverRouteMap selected={selected} alternatives={[]} loader={loader} />);

    expect(await screen.findByText("지도 인증을 확인하지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "선택 경로 구간 목록" })).toBeInTheDocument();
    expect(screen.getByText("1구간 · 그늘 · 350m")).toBeInTheDocument();
    expect(screen.getByText("2구간 · 햇빛 · 150m")).toBeInTheDocument();
    expect(screen.getByTestId("naver-route-map-canvas")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the segment list when a partially loaded third-party SDK throws", async () => {
    class BoundsMock {
      extend() {}
    }
    (window as Window & { naver?: unknown }).naver = {
      maps: {
        Map: class {},
        LatLng: class {},
        LatLngBounds: BoundsMock,
        Polyline: class {
          constructor() {
            throw new Error("partially initialized SDK");
          }
        },
      },
    };
    const loader = {
      getState: () => "READY" as const,
      subscribe: () => () => undefined,
      load: async () => undefined,
    };

    render(<NaverRouteMap selected={selected} alternatives={[]} loader={loader} />);

    expect(await screen.findByText("지도를 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "선택 경로 구간 목록" })).toBeInTheDocument();
  });

  it("labels an unanalyzed TMAP polyline only as a walking route", () => {
    const unanalyzed: RouteCandidateUiDto = {
      ...selected,
      spatialAnalysisAvailable: false,
      shadeRatio: null,
      segments: [
        {
          id: "neutral",
          exposure: "NEUTRAL",
          distanceM: 500,
          coordinates: [
            [128.6, 35.87],
            [128.606, 35.872],
          ],
        },
      ],
    };

    render(<NaverRouteMap selected={unanalyzed} alternatives={[]} />);

    expect(screen.getAllByText("보행 경로").length).toBeGreaterThan(0);
    expect(screen.queryByText("그늘")).not.toBeInTheDocument();
    expect(screen.queryByText("햇빛")).not.toBeInTheDocument();
  });

  it("toggles shadow visibility on and off via legend toggle button", async () => {
    const loader = {
      getState: () => "READY" as const,
      subscribe: () => () => undefined,
      load: () => Promise.resolve(),
    };

    render(
      <NaverRouteMap
        selected={selected}
        alternatives={[]}
        loader={loader}
        shadowCalculatedAt="2026-08-24T03:00:00.000Z"
      />,
    );

    const toggleBtn = screen.getByRole("button", { name: "건물 그림자 표시 전환" });
    expect(toggleBtn).toHaveTextContent("그림자 켬");
    expect(toggleBtn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent("그림자 끔");
    expect(toggleBtn).toHaveAttribute("aria-pressed", "false");
  });
});
