import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AlertDetailView } from "./AlertDetailView";

describe("AlertDetailView", () => {
  it("shows masked risk, at most three reasons, immediate actions and demo disclosure", () => {
    render(
      <AlertDetailView
        detail={{
          eventId: "123e4567-e89b-42d3-a456-426614174001",
          maskedName: "김○○",
          riskLevel: "L4",
          hri: 82,
          occurredAt: "2026-08-23T12:00:00.000Z",
          reasons: ["체감온도가 매우 높습니다", "열 관련 주의가 필요한 복약 정보가 있습니다"],
          demo: true,
        }}
      />,
    );

    expect(screen.getByText("DEMO · 실제 알림은 발송되지 않습니다")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /김○○ 님의 폭염 위험/ })).toBeInTheDocument();
    expect(screen.getByLabelText("HRI 82점")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /가까운 쉼터 찾기/ })).toHaveAttribute(
      "href",
      "/shelters?scope=alert",
    );
    expect(screen.getByRole("link", { name: /119에 전화/ })).toHaveAttribute("href", "tel:119");
    expect(screen.queryByText(/010-|상세주소/)).not.toBeInTheDocument();
  });
});
