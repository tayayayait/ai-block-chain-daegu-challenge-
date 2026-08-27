import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StaffLoginForm } from "./route-access-login";

afterEach(cleanup);

describe("StaffLoginForm", () => {
  it("exposes labeled email/password fields and redirects only after success", async () => {
    const authenticate = vi.fn(async () => ({ ok: true }) as const);
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(
      <StaffLoginForm
        nextPath="/dashboard?gu=수성구"
        authenticate={authenticate}
        onSuccess={onSuccess}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "이메일" }), "care@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "safe-password");
    await user.click(screen.getByRole("button", { name: "담당자 로그인" }));

    expect(authenticate).toHaveBeenCalledWith({
      email: "care@example.com",
      password: "safe-password",
    });
    expect(onSuccess).toHaveBeenCalledWith("/dashboard?gu=수성구");
  });

  it("announces loading, prevents duplicate submits, and exposes a safe alert", async () => {
    let resolveAuthentication: ((value: { ok: false; userMessage: string }) => void) | undefined;
    const authenticate = vi.fn(
      () =>
        new Promise<{ ok: false; userMessage: string }>((resolve) => {
          resolveAuthentication = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <StaffLoginForm nextPath="/dashboard" authenticate={authenticate} onSuccess={vi.fn()} />,
    );
    await user.type(screen.getByRole("textbox", { name: "이메일" }), "care@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "wrong-password");
    const submit = screen.getByRole("button", { name: "담당자 로그인" });
    await user.click(submit);

    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("로그인 확인 중");

    resolveAuthentication?.({
      ok: false,
      userMessage: "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.",
    );
    expect(authenticate).toHaveBeenCalledTimes(1);
  });
});
