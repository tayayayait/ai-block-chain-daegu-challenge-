import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Btn } from "./Btn";

describe("Btn element contract", () => {
  it("asChild 링크를 단일 anchor로 렌더해 interactive element 중첩을 만들지 않는다", () => {
    const { container } = render(
      <Btn asChild variant="secondary">
        <a href="/shelters">쉼터 경로 보기</a>
      </Btn>,
    );

    const link = screen.getByRole("link", { name: "쉼터 경로 보기" });
    expect(link).toHaveAttribute("href", "/shelters");
    expect(link).toHaveClass("inline-flex", "rounded-md");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a button, button a")).toBeNull();
  });

  it("기본 Btn은 기존 native button 동작을 유지한다", () => {
    const onClick = vi.fn();
    render(<Btn onClick={onClick}>위험도 저장</Btn>);

    const button = screen.getByRole("button", { name: "위험도 저장" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("loading 상태의 asChild 링크는 키보드·포인터 활성화를 차단한다", () => {
    const onClick = vi.fn();
    render(
      <Btn asChild loading>
        <a href="/shelters" onClick={onClick}>
          경로 계산 중…
        </a>
      </Btn>,
    );

    const link = screen.getByRole("link", { name: "경로 계산 중…" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(fireEvent.click(link)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading 중 라벨을 유지하고 접근성 상태와 클릭 차단을 제공한다", () => {
    const onClick = vi.fn();
    render(
      <Btn loading onClick={onClick}>
        복약 정보 저장
      </Btn>,
    );

    const button = screen.getByRole("button", { name: "복약 정보 저장" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("복약 정보 저장");
    expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("명시적으로 disabled 된 native 버튼도 포인터 활성화를 차단한다", () => {
    const onClick = vi.fn();
    render(
      <Btn disabled onClick={onClick}>
        제출할 수 없음
      </Btn>,
    );

    const button = screen.getByRole("button", { name: "제출할 수 없음" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("명시적으로 disabled 된 asChild 링크도 이동과 click handler를 차단한다", () => {
    const onClick = vi.fn();
    render(
      <Btn asChild disabled>
        <a href="/shelters" onClick={onClick}>
          이용할 수 없는 경로
        </a>
      </Btn>,
    );

    const link = screen.getByRole("link", { name: "이용할 수 없는 경로" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(fireEvent.click(link)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Btn senior size", () => {
  it("버튼 높이와 최소 탭 영역을 CSS senior 토큰에서 가져온다", () => {
    render(
      <Btn size="senior">
        <svg aria-hidden="true" />큰 글씨로 경로 받기
      </Btn>,
    );

    const button = screen.getByRole("button", { name: "큰 글씨로 경로 받기" });
    expect(button.style.height).toBe("var(--btn-h)");
    expect(button.style.minHeight).toBe("var(--tap-min)");
    expect(button).toHaveClass("px-7", "text-[22px]", "[&_svg]:size-[var(--icon-size)]");
  });
});
