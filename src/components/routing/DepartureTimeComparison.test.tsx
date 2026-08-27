import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DepartureTimeComparison } from "./DepartureTimeComparison";
import type { DepartureComparisonUiDto, RoutePlanUiDto } from "./route-ui-dto";

const comparison = createComparison();

describe("DepartureTimeComparison", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("presents one continuous 0-to-60-minute timeline instead of time-slot buttons", () => {
    render(
      <DepartureTimeComparison
        comparison={comparison}
        selectedOffsetMinutes={0}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "언제 출발하면 덜 더울까요?" })).toBeVisible();
    expect(screen.getByRole("slider", { name: "출발 시각" })).toHaveAttribute("min", "0");
    expect(screen.getByRole("slider", { name: "출발 시각" })).toHaveAttribute("max", "60");
    expect(screen.getByRole("slider", { name: "출발 시각" })).toHaveAttribute("step", "0.1");
    expect(screen.getByRole("slider", { name: "출발 시각" })).toHaveValue("0");
    expect(screen.getByRole("button", { name: "일시정지" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /30분 후/u })).not.toBeInTheDocument();
    expect(screen.getByText("15:00")).toBeVisible();
    expect(screen.getByText("체감 36.2°C")).toBeVisible();
    expect(screen.getByText("그늘 52%")).toBeVisible();
    expect(screen.getByText("직사광선 약 18분")).toBeVisible();
  });

  it("scrubs to any minute, pauses playback, and updates every metric from the same frame", () => {
    const onSelect = vi.fn();

    function TimelineHarness() {
      const [offset, setOffset] = useState(0);
      return (
        <DepartureTimeComparison
          comparison={comparison}
          selectedOffsetMinutes={offset}
          onSelect={(nextOffset, plan) => {
            setOffset(nextOffset);
            onSelect(nextOffset, plan);
          }}
        />
      );
    }

    render(<TimelineHarness />);
    fireEvent.change(screen.getByRole("slider", { name: "출발 시각" }), {
      target: { value: "15" },
    });

    expect(screen.getByRole("slider", { name: "출발 시각" })).toHaveValue("15");
    expect(screen.getByRole("button", { name: "재생" })).toBeVisible();
    expect(screen.getByText("15:15")).toBeVisible();
    expect(screen.getByText("체감 35.8°C")).toBeVisible();
    expect(screen.getByText("그늘 57%")).toBeVisible();
    expect(screen.getByText("직사광선 약 16분")).toBeVisible();
    expect(onSelect).toHaveBeenLastCalledWith(
      15,
      expect.objectContaining({ shadowCalculatedAt: "2026-08-26T06:15:00.000Z" }),
    );
  });

  it("moves through fractional frames continuously between minute labels", () => {
    function TimelineHarness() {
      const [offset, setOffset] = useState(10);
      return (
        <DepartureTimeComparison
          comparison={comparison}
          selectedOffsetMinutes={offset}
          onSelect={(nextOffset) => setOffset(nextOffset)}
        />
      );
    }

    render(<TimelineHarness />);

    act(() => {
      vi.advanceTimersByTime(400);
    });

    const offset = Number(screen.getByRole("slider", { name: "출발 시각" }).getAttribute("value"));
    expect(offset).toBeGreaterThan(10);
    expect(offset).toBeLessThan(11);
  });

  it("advances one minute per animation beat and stops at one hour", () => {
    function TimelineHarness() {
      const [offset, setOffset] = useState(59);
      return (
        <DepartureTimeComparison
          comparison={comparison}
          selectedOffsetMinutes={offset}
          onSelect={(nextOffset) => setOffset(nextOffset)}
        />
      );
    }

    render(<TimelineHarness />);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByRole("slider", { name: "출발 시각" })).toHaveValue("60");
    expect(screen.getByRole("button", { name: "재생" })).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByRole("slider", { name: "출발 시각" })).toHaveValue("60");
  });
});

function createComparison(): DepartureComparisonUiDto {
  return {
    recommendedOffsetMinutes: 60,
    forecastSource: "KMA_VILLAGE_FORECAST",
    slots: [
      slot(0, "지금 출발", 36.2, 52, 18, 24, 0),
      slot(30, "30분 후", 35.3, 61, 14, 24, 0),
      slot(60, "1시간 후", 34.1, 74, 9, 25, 1),
    ],
  };
}

function slot(
  offsetMinutes: 0 | 30 | 60,
  label: "지금 출발" | "30분 후" | "1시간 후",
  feelsLikeC: number | null,
  shadePercent: number | null,
  directSunMinutes: number | null,
  walkingMinutes: number,
  additionalWalkingMinutes: number,
): DepartureComparisonUiDto["slots"][number] {
  const departureAt = new Date(
    Date.parse("2026-08-26T06:00:00.000Z") + offsetMinutes * 60_000,
  ).toISOString();
  return {
    offsetMinutes,
    label,
    departureAt,
    feelsLikeC,
    forecastAt: feelsLikeC === null ? null : "2026-08-26T15:00:00+09:00",
    forecastInterpolated: offsetMinutes === 30,
    shadePercent,
    directSunMinutes,
    walkingMinutes,
    additionalWalkingMinutes,
    plan: plan(departureAt, shadePercent),
  };
}

function plan(shadowCalculatedAt: string, shadePercent: number | null): RoutePlanUiDto {
  return {
    destinationName: "중구 무더위쉼터",
    afterSunset: false,
    shadowCalculatedAt,
    naverMapUrl: null,
    candidates: [
      {
        id: "route-1",
        label: "후보 1",
        distanceM: 520,
        spatialAnalysisAvailable: true,
        shadeRatio: shadePercent === null ? null : shadePercent / 100,
        shadows: [],
        segments: [],
        restSpots: [],
        warnings: [],
      },
    ],
  };
}
