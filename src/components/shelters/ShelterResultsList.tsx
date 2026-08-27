import { ShelterCard } from "@/components/onjung/ShelterCard";
import type { ShelterEmptyAction } from "@/lib/shelters/empty-state";
import type { PublicShelterDto } from "@/lib/shelters/public-dto";
import type { ShelterSearchQuery } from "@/lib/shelters/search-schema";

const resetFilters = (query: ShelterSearchQuery): ShelterSearchQuery => ({
  lat: query.lat,
  lng: query.lng,
  radius: query.radius,
  imBank: false,
  open: "ALL",
  sort: query.sort,
  limit: query.limit,
});
const minutesSince = (value: string | null, now: string): number | null => {
  if (value === null) return null;
  const elapsed = new Date(now).getTime() - new Date(value).getTime();
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 60_000)) : null;
};

export const ShelterResultsList = ({
  shelters,
  now,
  query,
  emptyAction,
  selectedId,
  onSelect,
  onQueryChange,
  onRequestRoute,
  routeLoadingId,
  updating = false,
}: {
  shelters: readonly PublicShelterDto[];
  now: string;
  query: ShelterSearchQuery;
  emptyAction: ShelterEmptyAction;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onQueryChange: (query: ShelterSearchQuery) => void;
  onRequestRoute?: (shelter: PublicShelterDto) => void;
  routeLoadingId?: string | null;
  updating?: boolean;
}) => (
  <section className="order-1 lg:order-2 lg:col-span-5" aria-labelledby="shelter-results">
    <div className="flex items-end justify-between gap-3">
      <h2 id="shelter-results" className="t-h2">
        쉼터 목록
      </h2>
      <p className="t-caption text-fg-2" aria-live="polite">
        {shelters.length}곳
      </p>
    </div>
    {shelters.length > 0 ? (
      <ul className="mt-4 space-y-3">
        {shelters.map((shelter) => (
          <li key={shelter.id} id={`shelter-${shelter.id}`}>
            <ShelterCard
              shelter={{ ...shelter, lastReportMinAgo: minutesSince(shelter.lastReportAt, now) }}
              className={selectedId === shelter.id ? "ring-2 ring-brand" : ""}
              action={
                <div className="flex flex-wrap gap-2">
                  {onRequestRoute ? (
                    <button
                      type="button"
                      onClick={() => onRequestRoute(shelter)}
                      disabled={updating || routeLoadingId !== null}
                      className="t-body-s min-h-10 rounded-md bg-brand px-4 font-bold text-white disabled:cursor-wait disabled:opacity-60"
                      aria-label={`${shelter.name} 보행 경로 보기`}
                    >
                      {updating
                        ? "조건 적용 중…"
                        : routeLoadingId === shelter.id
                          ? "경로 계산 중…"
                          : "보행 경로 보기"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onSelect(shelter.id)}
                    className="t-body-s min-h-10 rounded-md border border-brand px-4 font-semibold text-brand"
                  >
                    지도에서 보기
                  </button>
                  <a
                    href={`/report/${encodeURIComponent(shelter.id)}`}
                    className="t-body-s inline-flex min-h-10 items-center rounded-md border border-border px-4 font-semibold"
                    aria-label={`${shelter.name} 운영상태 제보`}
                  >
                    운영상태 제보
                  </a>
                </div>
              }
            />
          </li>
        ))}
      </ul>
    ) : (
      <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center">
        <p className="t-body-s text-fg-2">
          {query.gu ? "해당 지역에 등록된 쉼터가 없습니다." : "현재 조건에 맞는 쉼터가 없습니다."}
        </p>
        {emptyAction.type === "EXPAND_RADIUS" ? (
          <button
            type="button"
            onClick={() => onQueryChange({ ...query, radius: emptyAction.radius })}
            className="t-body-s mt-4 min-h-11 rounded-md border border-brand px-4 font-bold text-brand"
          >
            {emptyAction.radius === 1000 ? "1km로 넓히기" : "3km로 넓히기"}
          </button>
        ) : null}
        {emptyAction.type === "RESET_FILTERS" ? (
          <button
            type="button"
            onClick={() => onQueryChange(resetFilters(query))}
            className="t-body-s mt-4 min-h-11 rounded-md border border-brand px-4 font-bold text-brand"
          >
            필터 초기화
          </button>
        ) : null}
      </div>
    )}
  </section>
);
