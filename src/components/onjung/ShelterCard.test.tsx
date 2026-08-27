import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ShelterCard } from "./ShelterCard";

describe("ShelterCard", () => {
  it("쉼터 운영·검증·거리·그늘 정보를 한 카드에서 제공한다", () => {
    render(
      <ShelterCard
        shelter={{
          id: "sh-001",
          name: "DGB대구은행 서문시장지점",
          facilityType: "금융기관",
          gu: "중구",
          isImBank: true,
          roadAddress: "대구광역시 중구 큰장로 26길 25",
          distanceM: 320,
          walkMin: 7,
          open: "OPEN",
          crowd: "SPARSE",
          lastReportMinAgo: 14,
          attest: "VERIFIED",
          attestUid: "0xabc",
          shadeRatio: 0.68,
        }}
        action={<a href="/route/sh-001">경로 보기</a>}
      />,
    );

    const card = screen.getByRole("article", { name: "DGB대구은행 서문시장지점 쉼터 정보" });
    expect(within(card).getByText("iM뱅크")).toBeInTheDocument();
    expect(card).toHaveTextContent("금융기관 · 중구 · 320m · 도보 7분");
    expect(card).toHaveTextContent("대구광역시 중구 큰장로 26길 25");
    expect(within(card).getByText("운영 중")).toBeInTheDocument();
    expect(within(card).getByText("여유")).toBeInTheDocument();
    expect(within(card).getByText("14분 전 확인")).toBeInTheDocument();
    expect(within(card).getByText("Base Sepolia 테스트넷")).toBeInTheDocument();
    expect(card).toHaveTextContent("그늘 비율 68%");
    expect(within(card).getByRole("link", { name: "경로 보기" })).toHaveAttribute(
      "href",
      "/route/sh-001",
    );
  });

  it("미확인 운영 상태와 보고 이력 부재를 추측하지 않고 표시한다", () => {
    render(
      <ShelterCard
        shelter={{
          id: "sh-002",
          name: "동인동 쉼터",
          facilityType: "행정복지센터",
          gu: "중구",
          isImBank: false,
          distanceM: 1_240,
          walkMin: 28,
          open: "UNKNOWN",
          lastReportMinAgo: null,
          attest: "UNVERIFIED",
          shadeRatio: 0,
        }}
      />,
    );

    expect(screen.getByText("운영 미확인")).toBeInTheDocument();
    expect(screen.getByText("확인 기록 없음")).toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveTextContent(
      "행정복지센터 · 중구 · 1.2km · 도보 28분",
    );
    expect(screen.queryByText("iM뱅크")).not.toBeInTheDocument();
  });

  it("Phase 6 이전처럼 그늘 계산값이 없으면 그늘 비율을 숨긴다", () => {
    render(
      <ShelterCard
        shelter={{
          id: "sh-003",
          name: "국채보상운동기념공원 쉼터",
          facilityType: "공원",
          gu: "중구",
          isImBank: false,
          distanceM: 480,
          walkMin: 11,
          open: "OPEN",
          lastReportMinAgo: null,
          attest: "UNVERIFIED",
        }}
      />,
    );

    expect(screen.queryByText(/그늘 비율/)).not.toBeInTheDocument();
  });
});
