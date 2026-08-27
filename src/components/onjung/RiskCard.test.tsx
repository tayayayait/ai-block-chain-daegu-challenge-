import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RiskCard } from "./RiskCard";

describe("RiskCard", () => {
  it("위험도, 대상자, 환경 정보와 최대 3개의 사유를 표시한다", () => {
    render(
      <RiskCard
        level="L3"
        score={72}
        subject={{ maskedName: "김○○", age: 82, livesAlone: true }}
        feelsLikeC={39.2}
        location="수성구 파동"
        reasons={[
          "이뇨제 복용 (+12)",
          "체감온도 (+47)",
          "독거 (+5)",
          "표시하면 안 되는 네 번째 사유",
        ]}
        action={<a href="/subjects/s-001/route">쉼터 경로 발송</a>}
      />,
    );

    const card = screen.getByRole("article", { name: "김○○ 위험도" });
    expect(within(card).getByText("72")).toHaveClass("num");
    expect(card).toHaveTextContent("김○○ · 82세 · 독거");
    expect(card).toHaveTextContent("체감 39.2℃ · 수성구 파동");
    expect(within(card).getAllByRole("listitem")).toHaveLength(3);
    expect(within(card).queryByText("표시하면 안 되는 네 번째 사유")).not.toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "쉼터 경로 발송" })).toHaveAttribute(
      "href",
      "/subjects/s-001/route",
    );
  });

  it("L4 카드에만 위험 펄스 보더 상태를 부여한다", () => {
    const common = {
      score: 84,
      subject: { maskedName: "박○○", age: 79, livesAlone: false },
      feelsLikeC: 40,
      location: "중구 동인동",
      reasons: ["체감온도 (+49)"],
    } as const;
    const { rerender } = render(<RiskCard {...common} level="L4" />);

    expect(screen.getByRole("article")).toHaveAttribute("data-alert-pulse", "true");

    rerender(<RiskCard {...common} level="L3" />);
    expect(screen.getByRole("article")).not.toHaveAttribute("data-alert-pulse");
  });
});
