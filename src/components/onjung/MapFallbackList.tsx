import { useId, useMemo, useState } from "react";

import { FormField } from "./FormField";
import { ShelterCard, type ShelterCardData } from "./ShelterCard";

type ShelterSort = "distance" | "shade" | "name";

export interface MapFallbackListProps {
  shelters: readonly ShelterCardData[];
  getRouteHref: (shelter: ShelterCardData) => string;
  surface?: "shade" | "paper";
  title?: string;
  emptyMessage?: string;
}

function searchableText(shelter: ShelterCardData) {
  return [shelter.name, shelter.gu, shelter.facilityType, shelter.roadAddress ?? ""]
    .join(" ")
    .toLocaleLowerCase("ko-KR");
}

export function MapFallbackList({
  shelters,
  getRouteHref,
  surface = "paper",
  title = "쉼터 목록",
  emptyMessage = "검색 조건에 맞는 쉼터가 없습니다.",
}: MapFallbackListProps) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ShelterSort>("distance");
  const hasShadeData = useMemo(
    () => shelters.some((shelter) => shelter.shadeRatio !== undefined),
    [shelters],
  );

  const visibleShelters = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    const filtered = normalizedQuery
      ? shelters.filter((shelter) => searchableText(shelter).includes(normalizedQuery))
      : [...shelters];

    return filtered.sort((left, right) => {
      if (sort === "shade") {
        const rightShade = right.shadeRatio ?? Number.NEGATIVE_INFINITY;
        const leftShade = left.shadeRatio ?? Number.NEGATIVE_INFINITY;
        return rightShade - leftShade;
      }
      if (sort === "name") return left.name.localeCompare(right.name, "ko-KR");
      return left.distanceM - right.distanceM;
    });
  }, [query, shelters, sort]);

  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="t-h2">
        {title}
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px] sm:items-end">
        <FormField
          kind="search"
          surface={surface}
          label="쉼터 검색"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="예: 중구, 금융기관"
        />
        <div>
          <label htmlFor={`${titleId}-sort`} className="t-body-s mb-1.5 block font-semibold">
            쉼터 정렬
          </label>
          <select
            id={`${titleId}-sort`}
            value={sort}
            onChange={(event) => setSort(event.currentTarget.value as ShelterSort)}
            className="bg-raised border-border text-foreground t-body-s w-full rounded-md border px-3"
            style={{ minHeight: surface === "shade" ? "40px" : "var(--btn-h)" }}
          >
            <option value="distance">가까운 거리순</option>
            {hasShadeData ? <option value="shade">그늘 비율순</option> : null}
            <option value="name">이름순</option>
          </select>
        </div>
      </div>

      <p className="t-caption text-fg-2 mt-3" aria-live="polite">
        총 <span className="num">{visibleShelters.length}</span>곳
      </p>

      {visibleShelters.length > 0 ? (
        <ul aria-label="쉼터 검색 결과" className="mt-4 space-y-3">
          {visibleShelters.map((shelter) => (
            <li key={shelter.id}>
              <ShelterCard
                shelter={shelter}
                surface={surface}
                action={
                  <a
                    href={getRouteHref(shelter)}
                    aria-label={`${shelter.name} 경로 요청`}
                    className="border-brand text-brand t-body-s inline-flex min-h-10 items-center rounded-md border px-4 font-semibold"
                  >
                    경로 요청
                  </a>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-body-s text-fg-2 mt-4 rounded-lg border border-dashed p-6 text-center">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}
