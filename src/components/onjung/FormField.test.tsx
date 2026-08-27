import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormField } from "./FormField";

describe("FormField", () => {
  it("label, 오류, 도움말을 입력 요소에 연결한다", () => {
    render(
      <FormField
        id="phone"
        kind="phone"
        label="연락처"
        hint="보호자 연락처를 입력하세요."
        error="전화번호 형식을 확인해 주세요."
        placeholder="예: 010-1234-5678"
      />,
    );

    const input = screen.getByLabelText("연락처");
    expect(input).toHaveAttribute("type", "tel");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "tel");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("placeholder", "예: 010-1234-5678…");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "보호자 연락처를 입력하세요. 전화번호 형식을 확인해 주세요.",
    );
    expect(screen.getByText("전화번호 형식을 확인해 주세요.")).toHaveAttribute("role", "alert");
  });

  it.each([
    ["age", "number", "numeric", null],
    ["name", "text", null, "name"],
    ["address", "text", null, "street-address"],
  ] as const)("%s 입력의 의미 속성을 고정한다", (kind, type, inputMode, autoComplete) => {
    render(<FormField kind={kind} label="필드" />);
    const input = screen.getByLabelText("필드");

    expect(input).toHaveAttribute("type", type);
    if (inputMode) expect(input).toHaveAttribute("inputmode", inputMode);
    else expect(input).not.toHaveAttribute("inputmode");
    if (autoComplete) expect(input).toHaveAttribute("autocomplete", autoComplete);
    else expect(input).not.toHaveAttribute("autocomplete");
  });

  it("surface별 높이를 적용하고 native disabled 상태를 유지한다", () => {
    const { rerender } = render(<FormField surface="shade" label="관제 입력" disabled />);
    expect(screen.getByLabelText("관제 입력")).toBeDisabled();
    expect(screen.getByLabelText("관제 입력")).toHaveStyle({ minHeight: "40px" });

    rerender(<FormField surface="paper" label="시민 입력" />);
    expect(screen.getByLabelText("시민 입력")).toHaveStyle({ minHeight: "var(--btn-h)" });
  });
});
