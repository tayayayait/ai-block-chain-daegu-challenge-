import { render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { LiveHomeSummary } from "@/lib/home/live-summary.server";

const routeState = vi.hoisted(() => ({ loader: {} as unknown }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    options,
    useLoaderData: () => routeState.loader,
  }),
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: () => vi.fn() }),
}));

import { Route } from "./index";

const available: LiveHomeSummary = {
  fetchedAt: "2026-08-24T03:40:00.000Z",
  weather: {
    source: "KMA_APIHUB_500M",
    observedAt: "2026-08-24T12:30:00+09:00",
    feelsLikeC: 34.8,
    airTemperatureC: 33.1,
    relativeHumidityPct: 62,
  },
  heatAdvisory: "WARNING",
  shelterCount: 950,
  availability: {
    weather: "AVAILABLE",
    heatAdvisory: "AVAILABLE",
    shelters: "AVAILABLE",
  },
};

describe("public home live evidence", () => {
  it("renders actual provider values and source labels without public subject aggregates", () => {
    routeState.loader = available;
    const Component = Route.options.component as ComponentType;
    render(<Component />);

    expect(screen.getByText(/34\.8/u)).toBeInTheDocument();
    expect(screen.getByText("폭염경보 발효 중")).toBeInTheDocument();
    expect(screen.getByText(/기상청 API허브 500m 관측/u)).toBeInTheDocument();
    expect(screen.getByText("대구 무더위쉼터 950곳")).toBeInTheDocument();
    expect(screen.queryByText("관할 대상자")).not.toBeInTheDocument();
    expect(screen.queryByText("위험 L4")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /온체인 증명 검증/u })).not.toBeInTheDocument();
  });

  it("shows honest unavailable states without rendering made-up numeric values", () => {
    routeState.loader = {
      fetchedAt: "2026-08-24T03:40:00.000Z",
      weather: null,
      heatAdvisory: null,
      shelterCount: null,
      availability: {
        weather: "UNAVAILABLE",
        heatAdvisory: "UNAVAILABLE",
        shelters: "UNAVAILABLE",
      },
    } satisfies LiveHomeSummary;
    const Component = Route.options.component as ComponentType;
    render(<Component />);

    expect(screen.getByText("기상 관측을 일시적으로 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("특보 확인 지연")).toBeInTheDocument();
    expect(screen.getByText("쉼터 수 집계 지연")).toBeInTheDocument();
    expect(screen.queryByText(/0\.0\s*℃/u)).not.toBeInTheDocument();
  });

  it("prioritizes the login-free shelter action and keeps staff access secondary", () => {
    routeState.loader = available;
    const Component = Route.options.component as ComponentType;
    render(<Component />);

    expect(
      screen.getByRole("heading", { level: 1, name: /오늘 더위, 내 몸에 맞게 대비하세요/u }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "가까운 쉼터 찾기" })).toHaveAttribute(
      "href",
      "/shelters",
    );
    expect(screen.queryByRole("link", { name: "복용약 정보 확인" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /돌봄 담당자 로그인/u })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("button", { name: /큰 글씨 모드/u })).toBeInTheDocument();
    expect(screen.queryByText("관제 대시보드")).not.toBeInTheDocument();
  });
});
