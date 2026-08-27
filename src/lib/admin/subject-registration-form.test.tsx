import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SubjectRegistrationForm } from "./subject-registration-form";
import type { SubjectRegistrationInput } from "./subject-registration.schema";

describe("SubjectRegistrationForm", () => {
  it("requires explicit real answers and does not prefill a fake person", () => {
    render(<SubjectRegistrationForm submit={vi.fn()} />);

    expect(screen.getByLabelText("이름")).toHaveValue("");
    expect(screen.getByLabelText("출생연도")).toHaveValue(null);
    expect(screen.getByLabelText("성별")).toHaveValue("");
    expect(screen.getByLabelText("주소")).toHaveValue("");
    expect(screen.queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /개인정보 수집·이용에 동의/u })).not.toBeChecked();
  });

  it("submits entered values without any client-provided coordinate or organization", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async (_input: SubjectRegistrationInput) => ({
      kind: "success" as const,
      subjectId: "30000000-0000-4000-8000-000000000001",
      canonicalAddress: "대구광역시 중구 국채보상로 670",
      initialRisk: "DELAYED" as const,
    }));
    render(<SubjectRegistrationForm submit={submit} />);

    await user.type(screen.getByLabelText("이름"), "김온중");
    await user.type(screen.getByLabelText("출생연도"), "1941");
    await user.selectOptions(screen.getByLabelText("성별"), "FEMALE");
    await user.type(screen.getByLabelText("주소"), "대구광역시 중구 국채보상로 670");
    await user.click(screen.getByRole("radio", { name: "독거 예" }));
    await user.click(screen.getByRole("radio", { name: "만성질환 아니요" }));
    await user.click(screen.getByRole("radio", { name: "냉방기기 예" }));
    await user.click(screen.getByRole("radio", { name: "큰 글씨 아니요" }));
    await user.click(screen.getByRole("checkbox", { name: /개인정보 수집·이용에 동의/u }));
    await user.click(screen.getByRole("button", { name: "대상자 등록" }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      registrationRequestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      ),
      name: "김온중",
      birthYear: 1941,
      sex: "FEMALE",
      phone: "",
      guardianPhone: "",
      address: "대구광역시 중구 국채보상로 670",
      livesAlone: true,
      chronicDisease: false,
      hasCooling: true,
      seniorMode: false,
      consent: true,
    });
    expect(JSON.stringify(submit.mock.calls[0]?.[0])).not.toMatch(
      /latitude|longitude|organization|profileId/iu,
    );
    expect(await screen.findByText("위험도 계산 지연")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "등록된 대상자 보기" })).toHaveAttribute(
      "href",
      "/subjects/30000000-0000-4000-8000-000000000001",
    );
  });

  it("does not call the server while a required answer is missing", async () => {
    const submit = vi.fn();
    render(<SubjectRegistrationForm submit={submit} />);

    fireEvent.submit(screen.getByRole("form", { name: "대상자 등록 양식" }));

    expect(submit).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("필수 항목을 모두 입력");
  });
});
