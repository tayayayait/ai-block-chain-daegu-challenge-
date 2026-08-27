import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastViewport, type ToastEntry } from "./Toast";

describe("ToastViewport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("최신 3개만 남기고 오래된 토스트를 제거한다", () => {
    const toasts: ToastEntry[] = [
      { id: "1", kind: "info", message: "첫 번째" },
      { id: "2", kind: "success", message: "두 번째" },
      { id: "3", kind: "info", message: "세 번째" },
      { id: "4", kind: "success", message: "네 번째" },
    ];
    render(<ToastViewport surface="shade" toasts={toasts} onDismiss={vi.fn()} />);

    expect(screen.queryByText("첫 번째")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("toast-item")).toHaveLength(3);
  });

  it("정보·성공은 polite status, 오류는 assertive alert로 알린다", () => {
    const toasts: ToastEntry[] = [
      { id: "info", kind: "info", message: "새 관측값을 불러왔습니다." },
      { id: "success", kind: "success", message: "저장했습니다." },
      {
        id: "error",
        kind: "error",
        message: "저장 실패 — 네트워크를 확인하세요.",
        action: { label: "다시 시도", onClick: vi.fn() },
      },
    ];

    const { container } = render(<ToastViewport toasts={toasts} onDismiss={vi.fn()} />);

    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);
    expect(statuses.every((status) => status.getAttribute("aria-live") === "polite")).toBe(true);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(container.querySelector('[aria-label="알림"]')).toHaveAttribute("aria-live", "polite");
  });

  it("성공·정보 토스트는 4초 후 닫고 오류 토스트는 다음 행동과 수동 닫기를 제공한다", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onRetry = vi.fn();
    const toasts: ToastEntry[] = [
      { id: "ok", kind: "success", message: "저장했습니다." },
      {
        id: "error",
        kind: "error",
        message: "저장 실패 — 네트워크를 확인하고 다시 시도하세요.",
        action: { label: "다시 시도", onClick: onRetry },
      },
    ];
    render(<ToastViewport surface="paper" toasts={toasts} onDismiss={onDismiss} />);

    act(() => vi.advanceTimersByTime(4_000));
    expect(onDismiss).toHaveBeenCalledWith("ok");
    expect(onDismiss).not.toHaveBeenCalledWith("error");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "오류 알림 닫기" }));
    expect(onDismiss).toHaveBeenCalledWith("error");
  });
});
