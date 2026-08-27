import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NaverMapsLoadState } from "@/lib/naver/maps-loader";

import {
  clusterHeatReliefMapPoints,
  clusterShelterMapPoints,
  NaverShelterMap,
  type HeatReliefMapPoint,
  type ShelterMapPoint,
} from "./NaverShelterMap";

const point = (index: number): ShelterMapPoint => ({
  id: `s-${index}`,
  name: `쉼터 ${index}`,
  latitude: 35.87 + index * 0.00001,
  longitude: 128.6 + index * 0.00001,
  open: index % 2 === 0 ? "OPEN" : "UNKNOWN",
  isImBank: index % 3 === 0,
});

describe("NaverShelterMap", () => {
  afterEach(() => {
    delete (window as Window & { naver?: unknown }).naver;
  });

  it("keeps individual markers at 50 points or fewer", () => {
    const markers = clusterShelterMapPoints(Array.from({ length: 50 }, (_, index) => point(index)));

    expect(markers).toHaveLength(50);
    expect(markers.every((marker) => marker.kind === "POINT")).toBe(true);
  });

  it("clusters nearby points once the result exceeds 50", () => {
    const markers = clusterShelterMapPoints(Array.from({ length: 51 }, (_, index) => point(index)));

    expect(markers.length).toBeLessThan(51);
    expect(markers.some((marker) => marker.kind === "CLUSTER")).toBe(true);
    expect(markers.reduce((sum, marker) => sum + marker.count, 0)).toBe(51);
  });

  it("clusters dense public heat-relief facilities independently from cooling shelters", () => {
    const points: HeatReliefMapPoint[] = Array.from({ length: 81 }, (_, index) => ({
      id: `relief-${index}`,
      name: `그늘막 ${index}`,
      latitude: 35.87 + index * 0.00001,
      longitude: 128.6 + index * 0.00001,
      type: "SHADE_CANOPY",
    }));

    const markers = clusterHeatReliefMapPoints(points);

    expect(markers.length).toBeLessThan(81);
    expect(markers.reduce((sum, marker) => sum + marker.count, 0)).toBe(81);
  });

  it("shows an audited facility legend even when the optional map cannot load", () => {
    const reliefPoints: HeatReliefMapPoint[] = [
      { id: "shade", name: "그늘막", latitude: 35.87, longitude: 128.6, type: "SHADE_CANOPY" },
      { id: "bench", name: "벤치", latitude: 35.871, longitude: 128.601, type: "BENCH" },
      { id: "pavilion", name: "정자", latitude: 35.872, longitude: 128.602, type: "PAVILION" },
    ];

    render(<NaverShelterMap points={[point(1)]} reliefPoints={reliefPoints} ncpKeyId="" />);

    expect(screen.getByText("주변 폭염 안전시설 3곳")).toBeInTheDocument();
    expect(screen.getByText("그늘막 1")).toBeInTheDocument();
    expect(screen.getByText("벤치 1")).toBeInTheDocument();
    expect(screen.getByText("정자 1")).toBeInTheDocument();
  });

  it("renders an accessible list-first fallback when map authentication fails", async () => {
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

    render(<NaverShelterMap points={[point(1)]} loader={loader} />);

    expect(await screen.findByText(/지도 인증을 확인하지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/아래 쉼터 목록은 그대로 이용할 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByTestId("naver-map-canvas")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the list-first fallback when a partially loaded third-party SDK throws", async () => {
    class LatLngBounds {
      extend() {}
    }
    (window as Window & { naver?: unknown }).naver = {
      maps: {
        Map: class {},
        LatLng: class {},
        LatLngBounds,
        Marker: class {
          constructor() {
            throw new Error("partially initialized SDK");
          }
        },
        Event: { addListener: () => ({}), removeListener: () => undefined },
      },
    };
    const loader = {
      getState: () => "READY" as const,
      subscribe: () => () => undefined,
      load: async () => undefined,
    };

    render(<NaverShelterMap points={[point(1)]} loader={loader} />);

    expect(await screen.findByText(/지도를 불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/아래 쉼터 목록은 그대로 이용할 수 있습니다/)).toBeInTheDocument();
  });

  it("provides a layer toggle button to show or hide outdoor heat-relief facilities", () => {
    const reliefPoints: HeatReliefMapPoint[] = [
      {
        id: "shade-1",
        name: "동성로 그늘막",
        latitude: 35.87,
        longitude: 128.6,
        type: "SHADE_CANOPY",
      },
    ];

    render(<NaverShelterMap points={[point(1)]} reliefPoints={reliefPoints} ncpKeyId="" />);

    const toggleButton = screen.getByRole("button", { name: /야외 폭염 안전시설 표시 전환/ });
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveTextContent("야외 시설 표시 중");
  });

  it("re-fits the map when a district switch moves the same number of shelters", () => {
    const fitBounds = vi.fn();
    class LatLngBounds {
      extend() {}
    }
    (window as Window & { naver?: unknown }).naver = {
      maps: {
        Map: class {
          fitBounds = fitBounds;
          getZoom() {
            return 14;
          }
          setZoom() {}
          setCenter() {}
          panTo() {}
        },
        LatLng: class {},
        LatLngBounds,
        Marker: class {
          setMap() {}
        },
        Event: { addListener: () => ({}), removeListener: () => undefined },
      },
    };
    const loader = {
      getState: () => "READY" as const,
      subscribe: () => () => undefined,
      load: async () => undefined,
    };
    const shelter = (id: string, latitude: number, longitude: number): ShelterMapPoint => ({
      id,
      name: `${id} 쉼터`,
      latitude,
      longitude,
      open: "OPEN",
      isImBank: false,
    });

    const { rerender } = render(
      <NaverShelterMap points={[shelter("DG-0001", 35.8695, 128.6025)]} loader={loader} />,
    );
    expect(fitBounds).toHaveBeenCalledTimes(1);

    rerender(<NaverShelterMap points={[shelter("DG-0500", 35.6944, 128.4335)]} loader={loader} />);

    expect(fitBounds).toHaveBeenCalledTimes(2);
  });
});
