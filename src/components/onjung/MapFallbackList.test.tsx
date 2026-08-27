import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MapFallbackList } from "./MapFallbackList";
import type { ShelterCardData } from "./ShelterCard";

const shelters: ShelterCardData[] = [
  {
    id: "far",
    name: "먼 그늘쉼터",
    facilityType: "공공시설",
    gu: "달서구",
    isImBank: false,
    distanceM: 900,
    walkMin: 20,
    open: "OPEN",
    lastReportMinAgo: 5,
    attest: "VERIFIED",
    shadeRatio: 0.8,
  },
  {
    id: "near",
    name: "가까운 은행쉼터",
    facilityType: "금융기관",
    gu: "중구",
    isImBank: true,
    distanceM: 120,
    walkMin: 3,
    open: "UNKNOWN",
    lastReportMinAgo: null,
    attest: "UNVERIFIED",
    shadeRatio: 0.3,
  },
];

describe("MapFallbackList", () => {
  it("지도 없이도 모든 쉼터와 경로 요청 링크를 제공한다", () => {
    render(<MapFallbackList shelters={shelters} getRouteHref={(item) => `/route/${item.id}`} />);

    const list = screen.getByRole("list", { name: "쉼터 검색 결과" });
    expect(within(list).getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "먼 그늘쉼터 경로 요청" })).toHaveAttribute(
      "href",
      "/route/far",
    );
  });

  it("이름·주소권역 검색과 거리·그늘 정렬을 목록 자체에서 수행한다", () => {
    render(<MapFallbackList shelters={shelters} getRouteHref={(item) => `/route/${item.id}`} />);

    fireEvent.change(screen.getByLabelText("쉼터 검색"), { target: { value: "중구" } });
    expect(screen.getByRole("article", { name: "가까운 은행쉼터 쉼터 정보" })).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "먼 그늘쉼터 쉼터 정보" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("쉼터 검색"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("쉼터 정렬"), { target: { value: "shade" } });
    const names = within(screen.getByRole("list", { name: "쉼터 검색 결과" }))
      .getAllByRole("article")
      .map((article) => article.getAttribute("aria-label"));
    expect(names).toEqual(["먼 그늘쉼터 쉼터 정보", "가까운 은행쉼터 쉼터 정보"]);
  });

  it("그늘 계산값이 하나도 없으면 Phase 6 전용 정렬과 값을 노출하지 않는다", () => {
    const withoutShade = shelters.map(({ shadeRatio: _shadeRatio, ...shelter }) => shelter);
    render(
      <MapFallbackList shelters={withoutShade} getRouteHref={(item) => `/route/${item.id}`} />,
    );

    expect(screen.queryByRole("option", { name: "그늘 비율순" })).not.toBeInTheDocument();
    expect(screen.queryByText(/그늘 비율/)).not.toBeInTheDocument();
  });
});
