import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VerificationView } from "./VerificationView";
import type { PublicAttestationVerification } from "@/lib/attestation/verification.server";

const UID = `0x${"11".repeat(32)}` as `0x${string}`;
const SUBJECT_HASH = `0x${"44".repeat(32)}` as `0x${string}`;
const PAYLOAD_HASH = `0x${"55".repeat(32)}` as `0x${string}`;
const SCHEMA_UID = `0x${"22".repeat(32)}` as `0x${string}`;
const ISSUER = `0x${"ab".repeat(20)}` as `0x${string}`;

const verified: PublicAttestationVerification = {
  status: "VERIFIED",
  network: "Base Sepolia 테스트넷",
  chainId: 84532,
  uid: UID,
  issuer: ISSUER,
  issuedAt: "2026-08-23T05:10:00.000Z",
  explorerUrl: `https://base-sepolia.easscan.org/attestation/view/${UID}`,
  schema: { kind: "CARE_EVENT", label: "CareEvent v1", uid: SCHEMA_UID },
  details: {
    kind: "CARE_EVENT",
    eventType: "보호자 알림 발송",
    riskLevel: "L3 경고",
    hriScore: 72,
    occurredAt: "2026-08-23T05:09:52.000Z",
    subjectHash: SUBJECT_HASH,
    payloadHash: PAYLOAD_HASH,
  },
};

describe("S-07 VerificationView", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders a verified CareEvent without personal information and links only to EAS", () => {
    render(<VerificationView result={verified} />);

    expect(screen.getByRole("heading", { name: "검증 완료" })).toBeInTheDocument();
    expect(screen.getAllByText("Base Sepolia 테스트넷").length).toBeGreaterThan(0);
    expect(screen.getByText("보호자 알림 발송")).toBeInTheDocument();
    expect(screen.getByText("L3 경고")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.queryByText(/이름|전화번호|주소|복약명/)).not.toBeInTheDocument();

    const explorer = screen.getByRole("link", {
      name: /Base Sepolia 익스플로러에서 보기/,
    });
    expect(explorer).toHaveAttribute(
      "href",
      `https://base-sepolia.easscan.org/attestation/view/${UID}`,
    );
    expect(explorer).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("copies a full value while visually presenting its shortened form", async () => {
    render(<VerificationView result={verified} />);

    expect(screen.getByText(`${SUBJECT_HASH.slice(0, 8)}…${SUBJECT_HASH.slice(-4)}`)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "대상자 해시 전체값 복사" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SUBJECT_HASH);
    expect(await screen.findByRole("status")).toHaveTextContent("대상자 해시 복사 완료");
  });

  it.each([
    [{ status: "NOT_FOUND" } as const, "이 증명을 찾을 수 없습니다. 주소를 확인해 주세요."],
    [{ status: "NOT_OURS", uid: UID } as const, "온중이 발급한 증명이 아닙니다."],
    [
      { status: "TEMPORARY_UNAVAILABLE", uid: UID } as const,
      "지금 증명을 조회할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    ],
  ])("renders the safe %s state", (result, message) => {
    render(<VerificationView result={result} />);

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("link", { name: "홈으로 이동" })).toHaveAttribute("href", "/");
  });

  it("renders revocation time and never labels a revoked record as verified", () => {
    render(
      <VerificationView
        result={{
          status: "REVOKED",
          network: "Base Sepolia 테스트넷",
          chainId: 84532,
          uid: UID,
          issuer: ISSUER,
          issuedAt: "2026-08-23T05:10:00.000Z",
          revokedAt: "2026-08-23T05:11:40.000Z",
          explorerUrl: `https://base-sepolia.easscan.org/attestation/view/${UID}`,
          schema: { kind: "CARE_EVENT", label: "CareEvent v1", uid: SCHEMA_UID },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "폐기된 증명" })).toBeInTheDocument();
    expect(screen.getAllByText(/2026.*08.*23/).length).toBeGreaterThan(0);
    expect(screen.queryByText("검증 완료")).not.toBeInTheDocument();
  });
});
