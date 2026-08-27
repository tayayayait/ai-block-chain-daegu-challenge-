import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BottomSheet, Modal } from "./Modal";

describe("Modal and BottomSheet", () => {
  it("Shade 모달을 대화상자로 열고 닫기 액션을 제공한다", () => {
    const onOpenChange = vi.fn();
    render(
      <Modal
        open
        onOpenChange={onOpenChange}
        title="경로 발송 확인"
        description="대상자에게 문자를 보냅니다."
      >
        <button type="button">발송</button>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "경로 발송 확인" });
    expect(dialog).toHaveAttribute("data-surface", "shade");
    expect(dialog).toHaveAccessibleDescription("대상자에게 문자를 보냅니다.");
    expect(dialog).toHaveStyle({ overscrollBehavior: "contain" });
    fireEvent.click(screen.getByRole("button", { name: "모달 닫기" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Paper 바텀시트에 90dvh 제한과 safe-area 하단 여백을 적용한다", () => {
    render(
      <BottomSheet defaultOpen title="경로 상세">
        <p>그늘 비율 68%</p>
      </BottomSheet>,
    );

    const dialog = screen.getByRole("dialog", { name: "경로 상세" });
    expect(dialog).toHaveAttribute("data-surface", "paper");
    expect(dialog).toHaveClass("max-h-[90dvh]");
    expect(dialog).toHaveStyle({
      paddingBottom: "calc(var(--sp-6) + env(safe-area-inset-bottom))",
    });
  });

  it("키보드로 열면 내부 첫 액션에 포커스하고 Tab 포커스를 가둔다", async () => {
    const user = userEvent.setup();
    render(
      <Modal trigger={<button type="button">모달 열기</button>} title="키보드 확인">
        <button type="button">첫 번째 액션</button>
        <button type="button">두 번째 액션</button>
      </Modal>,
    );

    const trigger = screen.getByRole("button", { name: "모달 열기" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const firstAction = await screen.findByRole("button", { name: "첫 번째 액션" });
    const secondAction = screen.getByRole("button", { name: "두 번째 액션" });
    const close = screen.getByRole("button", { name: "모달 닫기" });

    await waitFor(() => expect(firstAction).toHaveFocus());
    await user.tab();
    expect(secondAction).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(firstAction).toHaveFocus();
  });

  it("Esc로 닫힌 뒤 포커스를 원래 trigger로 복귀시킨다", async () => {
    const user = userEvent.setup();
    render(
      <Modal trigger={<button type="button">설정 열기</button>} title="설정">
        <button type="button">저장</button>
      </Modal>,
    );

    const trigger = screen.getByRole("button", { name: "설정 열기" });
    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "설정" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "설정" })).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
