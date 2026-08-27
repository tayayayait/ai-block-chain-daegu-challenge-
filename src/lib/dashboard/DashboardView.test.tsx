import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DashboardSnapshot } from "./types";
import { DashboardView } from "./DashboardView";

const snapshot: DashboardSnapshot = {
  source: "DEMO_FIXTURE",
  filter: { gu: "전체", level: "L3", sort: "hri", order: "desc" },
  summary: { total: 1, averageHri: 91, byLevel: { L2: 0, L3: 0, L4: 1 } },
  weather: {
    gu: "대구 전체",
    feelsLikeC: 39.2,
    advisory: "WARNING",
    observedAt: "2026-08-23T05:03:00.000Z",
    isPartial: false,
    isStale: false,
  },
  urgentSubjects: [
    {
      id: "subject-1",
      maskedName: "김○○",
      age: 82,
      livesAlone: true,
      gu: "수성구",
      locationLabel: "수성구 범어동",
      level: "L4",
      hri: 91,
      feelsLikeC: 39.2,
      reasons: ["폭염경보 발효 중"],
      updatedAt: "2026-08-23T05:03:00.000Z",
    },
  ],
  mapSubjects: [],
  careEvents: [],
  unreadL4Alerts: [
    {
      transitionId: "transition-1",
      subjectId: "subject-1",
      maskedName: "김○○",
      age: 82,
      hri: 91,
      occurredAt: "2026-08-23T05:03:00.000Z",
    },
  ],
  missingSources: [],
  fetchedAt: "2026-08-23T05:04:05.000Z",
};

const baseProps = {
  snapshot,
  state: "success" as const,
  onRetry: vi.fn(),
  onAcknowledgeL4: vi.fn(),
  acknowledging: false,
};

describe("DashboardView", () => {
  it("renders only unread L4 transitions as an assertive acknowledgement bar", () => {
    const onAcknowledgeL4 = vi.fn();
    render(<DashboardView {...baseProps} onAcknowledgeL4={onAcknowledgeL4} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    fireEvent.click(screen.getByRole("button", { name: "L4 신규 경보 확인" }));
    expect(onAcknowledgeL4).toHaveBeenCalledWith("transition-1");
  });

  it("shows an accessible risk list and an explicit map preparation state without fake markers", () => {
    render(<DashboardView {...baseProps} />);

    expect(screen.getByRole("status", { name: "지도 준비 상태" })).toHaveTextContent(
      "Naver 지도 연결 준비 중",
    );
    expect(screen.getByRole("list", { name: "지도 대체 위험 대상자 목록" })).toHaveTextContent(
      "김○○",
    );
    expect(screen.queryByTestId("fake-map-marker")).not.toBeInTheDocument();
  });

  it("renders the catalogued empty state", () => {
    render(
      <DashboardView
        {...baseProps}
        state="empty"
        snapshot={{ ...snapshot, urgentSubjects: [], unreadL4Alerts: [] }}
      />,
    );
    expect(screen.getByText("현재 L3 이상 대상자가 없습니다")).toBeInTheDocument();
    expect(
      screen.getByText("체감온도 31℃ 미만이면 위험도가 자동으로 낮아집니다"),
    ).toBeInTheDocument();
  });

  it("keeps current data visible while refreshing and reports the last update", () => {
    render(<DashboardView {...baseProps} state="refreshing" />);
    expect(screen.getByText("김○○")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "데이터 갱신 상태" })).toHaveTextContent("갱신 중");
    expect(screen.getByText(/마지막 갱신/)).toHaveTextContent("14:04");
  });

  it("never labels a local event UUID as an on-chain attestation UID", () => {
    const localEventId = "50000000-0000-4000-8000-000000000001";
    render(
      <DashboardView
        {...baseProps}
        snapshot={{
          ...snapshot,
          careEvents: [
            {
              id: localEventId,
              attestationUid: null,
              typeLabel: "방문 돌봄",
              occurredAt: "2026-08-23T05:03:00.000Z",
              attest: "PENDING",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("증명 UID 발급 대기")).toBeInTheDocument();
    expect(screen.queryByText(localEventId)).not.toBeInTheDocument();
  });

  it("renders partial and safe error states", () => {
    const { rerender } = render(
      <DashboardView
        {...baseProps}
        state="partial"
        snapshot={{ ...snapshot, missingSources: ["돌봄 기록"] }}
      />,
    );
    expect(screen.getByRole("status", { name: "부분 데이터 안내" })).toHaveTextContent("돌봄 기록");

    rerender(<DashboardView {...baseProps} snapshot={null} state="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("서버에 일시적인 문제가 있습니다");
  });
});
