import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FullSubjectPiiDto } from "@/lib/subjects/dto";

import { SubjectDetailView } from "./SubjectDetailView";
import type { SubjectDetailDto } from "./types";

afterEach(cleanup);

const detail: SubjectDetailDto = {
  subject: {
    id: "subject-1",
    maskedName: "김○○",
    shortAddress: "대구광역시 수성구",
    maskedPhone: "010-****-5678",
    age: 82,
    sex: "FEMALE",
    livesAlone: true,
    seniorMode: true,
    medicationRegistered: true,
  },
  latestRisk: {
    score: 70,
    level: "L3",
    breakdown: { E: 47, M: 12, P: 17, C: 6 },
    reasons: ["폭염경보가 발효 중입니다."],
    computedAt: "2026-08-23T05:03:00.000Z",
  },
  medications: [
    {
      id: "med-1",
      productName: "라식스정 40mg",
      heatClass: "이뇨제",
      riskTier: "HIGH",
      source: "AI_AUTO",
      confidence: 0.91,
      createdAt: "2026-08-22T00:00:00.000Z",
    },
  ],
  careEvents: [],
};

describe("SubjectDetailView", () => {
  it("shows masked PII by default and requests full PII only after an explicit toggle", async () => {
    const fullPii: FullSubjectPiiDto = {
      id: "subject-1",
      name: "김온중",
      address: "대구광역시 수성구 파동로3길 62",
      phone: "010-1234-5678",
    };
    const requestFullPii = vi.fn(async () => ({ kind: "success", data: fullPii }) as const);
    const user = userEvent.setup();

    render(<SubjectDetailView detail={detail} requestFullPii={requestFullPii} />);

    expect(screen.getByText("김○○")).toBeInTheDocument();
    expect(screen.queryByText("김온중")).not.toBeInTheDocument();
    expect(requestFullPii).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "전체 개인정보 보기" }));
    expect(requestFullPii).toHaveBeenCalledTimes(1);
    expect(screen.getByText("김온중")).toBeInTheDocument();
    expect(screen.getByText("대구광역시 수성구 파동로3길 62")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "개인정보 가리기" }));
    expect(screen.queryByText("김온중")).not.toBeInTheDocument();
    expect(requestFullPii).toHaveBeenCalledTimes(1);
  });

  it("keeps masked values and reports a safe error when reveal is denied", async () => {
    const user = userEvent.setup();
    render(
      <SubjectDetailView
        detail={detail}
        requestFullPii={async () => ({
          kind: "error",
          error: {
            code: "NOT_FOUND",
            userMessage: "요청한 정보를 찾을 수 없습니다. 주소를 확인해 주세요.",
            retryable: false,
          },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "전체 개인정보 보기" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "요청한 정보를 찾을 수 없습니다. 주소를 확인해 주세요.",
    );
    expect(screen.getByText("김○○")).toBeInTheDocument();
  });

  it("keeps masked values when the separate reveal request has a network failure", async () => {
    const user = userEvent.setup();
    render(
      <SubjectDetailView
        detail={detail}
        requestFullPii={async () => {
          throw new Error("response body with private fields");
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "전체 개인정보 보기" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "네트워크에 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
    );
    expect(screen.getByText("김○○")).toBeInTheDocument();
    expect(screen.queryByText(/response body|private fields/)).not.toBeInTheDocument();
  });

  it("renders capped contribution ratios and the actual subtraction formula as text", () => {
    render(<SubjectDetailView detail={detail} />);

    const risk = screen.getByRole("region", { name: "위험도 구성" });
    expect(
      within(risk).getByRole("progressbar", { name: "환경 점수 47점 / 최대 50점" }),
    ).toHaveAttribute("aria-valuenow", "47");
    expect(
      within(risk).getByRole("progressbar", { name: "복약 점수 12점 / 최대 25점" }),
    ).toHaveStyle({ width: "48%" });
    expect(
      within(risk).getByRole("progressbar", { name: "개인 점수 17점 / 최대 20점" }),
    ).toHaveStyle({ width: "85%" });
    expect(within(risk).getByRole("progressbar", { name: "완화 점수 6점 / 최대 6점" })).toHaveStyle(
      { width: "100%" },
    );
    expect(within(risk).getByText("47 + 12 + 17 − 6 = 70")).toBeInTheDocument();
  });

  it.each([
    {
      medicationRegistered: false,
      text: "복약 정보가 등록되지 않았습니다.",
      cta: "약봉투 촬영을 현재 사용할 수 없습니다",
    },
    {
      medicationRegistered: true,
      text: "현재 복약 이력이 없습니다.",
      cta: "복약 정보 추가를 현재 사용할 수 없습니다",
    },
  ])("shows the actionable medication empty state", ({ medicationRegistered, text, cta }) => {
    render(
      <SubjectDetailView
        detail={{
          ...detail,
          subject: { ...detail.subject, medicationRegistered },
          medications: [],
        }}
      />,
    );

    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: cta })).toBeDisabled();
    expect(screen.getByText("현재 복약 정보 등록 기능을 사용할 수 없습니다.")).toBeInTheDocument();
  });

  it("describes a missing risk from the user's perspective without batch terminology", () => {
    render(<SubjectDetailView detail={{ ...detail, latestRisk: null }} />);

    expect(
      screen.getByText("최신 기상 데이터가 수집되면 위험도가 자동으로 계산됩니다."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/배치 상태/iu);
  });

  it("labels future actions as unavailable and never reports a fake success", async () => {
    render(
      <SubjectDetailView
        detail={{
          ...detail,
          careEvents: [
            {
              id: "event-1",
              type: "ALERT_SENT",
              riskLevel: "L3",
              hri: 70,
              occurredAt: "2026-08-23T05:03:00.000Z",
              attestationState: "VERIFIED",
              attestationUid: "0xabc",
              issuer: "demo-issuer",
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "약봉투 촬영을 현재 사용할 수 없습니다" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "쉼터 경로 발송을 현재 사용할 수 없습니다" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "보호자 알림이 현재 비활성화되어 있습니다" }),
    ).toBeDisabled();
    expect(screen.getByText("온체인 증명 상세를 현재 확인할 수 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /온체인 증명 검증/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/완료|발송했습니다/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Phase\s*\d|데모 알림|자동 생성|배치 상태/iu);
  });
});
