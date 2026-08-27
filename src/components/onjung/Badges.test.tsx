import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RiskLevel } from "@/lib/domain-types";

import { AttestBadge, RiskBadge } from "./Badges";

const LEVELS: readonly RiskLevel[] = ["L0", "L1", "L2", "L3", "L4"];

const EXPECTED = {
  L0: { label: "안전", shape: "●", mix: "12%" },
  L1: { label: "관심", shape: "◆", mix: "12%" },
  L2: { label: "주의", shape: "▲", mix: "14%" },
  L3: { label: "경고", shape: "■", mix: "14%" },
  L4: { label: "위험", shape: "✕", mix: null },
} as const;

describe("RiskBadge three-channel encoding", () => {
  it("L0~L4를 각각 색, 텍스트 라벨, 서로 다른 아이콘 형태로 렌더한다", () => {
    const { container } = render(
      <div>
        {LEVELS.map((level) => (
          <RiskBadge key={level} level={level} />
        ))}
      </div>,
    );

    const badges = Array.from(container.firstElementChild?.children ?? []);
    expect(badges).toHaveLength(5);

    const renderedShapes = badges.map((badge, index) => {
      const level = LEVELS[index];
      if (!level) {
        throw new Error(`Unexpected risk badge at index ${index}`);
      }
      const expected = EXPECTED[level];
      const icon = badge.querySelector('[aria-hidden="true"]');
      const style = badge.getAttribute("style") ?? "";

      expect(badge).toHaveTextContent(`${level} ${expected.label}`);
      expect(style).toContain(`var(--heat-${index})`);
      expect(icon).toHaveTextContent(expected.shape);

      if (expected.mix) {
        expect(style).toContain(`${expected.mix}`);
      } else {
        expect(badge).toHaveClass("pulse-l4");
      }

      return icon?.textContent;
    });

    expect(new Set(renderedShapes).size).toBe(5);
  });
});

describe("AttestBadge", () => {
  it("검증 링크의 접근 가능한 이름에 테스트넷을 명시한다", () => {
    render(<AttestBadge state="VERIFIED" uid="0xabc" />);

    expect(
      screen.getByRole("link", { name: /Base Sepolia 테스트넷.*온체인 증명 검증 열기/ }),
    ).toHaveAttribute("href", "/verify/0xabc");
  });
});
