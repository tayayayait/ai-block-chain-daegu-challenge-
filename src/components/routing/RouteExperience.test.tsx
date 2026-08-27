import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RouteExperience } from "./RouteExperience";
import type { RoutePlanUiDto } from "./route-ui-dto";

const plan: RoutePlanUiDto = {
  destinationName: "DGB대구은행 서문시장지점",
  afterSunset: false,
  shadowCalculatedAt: "2026-08-24T03:00:00.000Z",
  naverMapUrl: "https://map.naver.com/p/directions/route-a",
  candidates: [
    {
      id: "route-a",
      label: "후보 1",
      distanceM: 320,
      spatialAnalysisAvailable: true,
      shadeRatio: 0.68,
      shadows: [
        {
          type: "Polygon",
          coordinates: [
            [
              [128.6, 35.87],
              [128.602, 35.87],
              [128.602, 35.871],
              [128.6, 35.87],
            ],
          ],
        },
      ],
      segments: [
        {
          id: "a-shade",
          exposure: "SHADE",
          distanceM: 218,
          coordinates: [
            [128.6, 35.87],
            [128.602, 35.871],
          ],
        },
        {
          id: "a-sun",
          exposure: "SUN",
          distanceM: 102,
          coordinates: [
            [128.602, 35.871],
            [128.604, 35.872],
          ],
        },
      ],
      restSpots: [{ id: "rest-a", label: "달성공원 벤치", distanceAlongRouteM: 210 }],
      warnings: ["BARRIER_COVERAGE_PARTIAL"],
    },
    {
      id: "route-b",
      label: "후보 2",
      distanceM: 450,
      spatialAnalysisAvailable: true,
      shadeRatio: 0.42,
      shadows: [],
      segments: [
        {
          id: "b-sun",
          exposure: "SUN",
          distanceM: 450,
          coordinates: [
            [128.6, 35.87],
            [128.608, 35.874],
          ],
        },
      ],
      restSpots: [],
      warnings: ["REST_GAP_OVER_300M", "REST_COVERAGE_PARTIAL"],
    },
  ],
};

const loader = {
  getState: () => "MISSING_KEY_ID" as const,
  subscribe: () => () => undefined,
  load: () => Promise.reject(new Error("safe")),
};

describe("RouteExperience", () => {
  it("switches candidates and updates the accessible route summary", async () => {
    const user = userEvent.setup();
    const onCandidateChange = vi.fn();
    render(
      <RouteExperience
        plan={plan}
        mapLoader={loader}
        defaultDetailOpen
        onCandidateChange={onCandidateChange}
      />,
    );

    expect(screen.getByRole("dialog", { name: "후보 1 · 도보 8분" })).toBeInTheDocument();
    expect(screen.getByText("그늘 68%")).toBeInTheDocument();
    expect(screen.getByText(/8월 24일.*오후 12:00 기준/u)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "후보 2 선택" }));

    expect(onCandidateChange).toHaveBeenCalledWith("route-b");
    expect(screen.getByRole("dialog", { name: "후보 2 · 도보 10분" })).toBeInTheDocument();
    expect(screen.getByText("그늘 42%")).toBeInTheDocument();
    expect(screen.getByText("확인된 휴식 지점이 없습니다.")).toBeInTheDocument();
  });

  it("labels every route conservatively and exposes uncertainty without prohibited claims", () => {
    render(<RouteExperience plan={plan} mapLoader={loader} defaultDetailOpen />);

    const dialog = screen.getByRole("dialog", { name: "후보 1 · 도보 8분" });
    expect(within(dialog).getByText("시연용 접근성 우선 후보")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/미등록 계단·급경사·휴식시설 운영 여부는 보장하지 않으므로/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("장애물 자료가 제공되는 구역이 제한적입니다."),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("안전 경로");
    expect(dialog).not.toHaveTextContent("무계단 보장");
  });

  it("shows the exact sunset banner and explains that shade calculation is skipped", () => {
    render(
      <RouteExperience
        plan={{
          ...plan,
          afterSunset: true,
          candidates: [{ ...plan.candidates[0]!, shadeRatio: null }],
        }}
        mapLoader={loader}
        defaultDetailOpen
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("일몰 후 — 최단 경로로 안내합니다");
    expect(screen.getByText("그늘 계산 생략")).toBeInTheDocument();
  });

  it("shows a TMAP walking route without claiming shade or accessibility when spatial data is unavailable", () => {
    render(
      <RouteExperience
        plan={{
          ...plan,
          candidates: [
            {
              ...plan.candidates[0]!,
              spatialAnalysisAvailable: false,
              shadeRatio: null,
              segments: [],
              restSpots: [],
              warnings: [],
            },
          ],
        }}
        mapLoader={loader}
        defaultDetailOpen
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "후보 1 · 도보 8분" });
    expect(within(dialog).getByText("TMAP 보행 경로 후보")).toBeInTheDocument();
    expect(
      within(dialog).getByText("공간자료가 없어 그늘·장애물·휴식 지점 분석을 제공하지 않습니다."),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("그늘 0%");
    expect(dialog).not.toHaveTextContent("그늘 계산 생략");
    expect(dialog).not.toHaveTextContent("확인된 휴식 지점이 없습니다");
    expect(dialog).not.toHaveTextContent("공개 공간자료를 반영한 후보");
  });

  it("announces external navigation before offering a new-tab Naver Maps link", () => {
    render(<RouteExperience plan={plan} mapLoader={loader} defaultDetailOpen />);

    expect(
      screen.getByText(/선택하면 네이버 지도가 새 탭에서 열립니다.*후보 선택은 그대로 유지됩니다/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "네이버 지도로 열기 (새 탭)" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: "네이버 지도로 열기 (새 탭)" })).toHaveAttribute(
      "rel",
      "noreferrer noopener",
    );
  });

  it("does not render an unsafe external URL", () => {
    render(
      <RouteExperience
        plan={{ ...plan, naverMapUrl: "javascript:alert(1)" }}
        mapLoader={loader}
        defaultDetailOpen
      />,
    );

    expect(screen.queryByRole("link", { name: /네이버 지도로 열기/ })).toBeNull();
    expect(screen.getByText("네이버 지도 연결 주소를 확인할 수 없습니다.")).toBeInTheDocument();
  });
});
