import { DAEGU_GU, type ShelterSearchQuery } from "@/lib/shelters/search-schema";

const withoutGu = (query: ShelterSearchQuery): ShelterSearchQuery => ({
  lat: query.lat,
  lng: query.lng,
  radius: query.radius,
  imBank: query.imBank,
  open: query.open,
  sort: query.sort,
  limit: query.limit,
});

export const ShelterFilters = ({
  query,
  onChange,
}: {
  query: ShelterSearchQuery;
  onChange: (query: ShelterSearchQuery) => void;
}) => {
  const update = (patch: Partial<ShelterSearchQuery>) => onChange({ ...query, ...patch });
  return (
    <section
      className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-border bg-raised p-4 sm:grid-cols-3 lg:grid-cols-6"
      aria-label="쉼터 필터"
    >
      <label className="t-caption font-semibold">
        반경
        <select
          value={query.radius}
          onChange={(event) =>
            update({ radius: Number(event.currentTarget.value) as 500 | 1000 | 3000 })
          }
          className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2"
        >
          <option value={500}>500m</option>
          <option value={1000}>1km</option>
          <option value={3000}>3km</option>
        </select>
      </label>
      <label className="t-caption font-semibold">
        구·군
        <select
          value={query.gu ?? ""}
          onChange={(event) =>
            onChange(
              event.currentTarget.value
                ? { ...query, gu: event.currentTarget.value as (typeof DAEGU_GU)[number] }
                : withoutGu(query),
            )
          }
          className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2"
        >
          <option value="">대구 전체</option>
          {DAEGU_GU.map((gu) => (
            <option key={gu} value={gu}>
              {gu}
            </option>
          ))}
        </select>
      </label>
      <label className="t-caption font-semibold">
        운영 상태
        <select
          value={query.open}
          onChange={(event) =>
            update({ open: event.currentTarget.value as ShelterSearchQuery["open"] })
          }
          className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2"
        >
          <option value="ALL">전체</option>
          <option value="OPEN">운영 중</option>
          <option value="UNKNOWN">미확인</option>
          <option value="CLOSED">운영 종료</option>
        </select>
      </label>
      <label className="t-caption font-semibold">
        정렬
        <select
          value={query.sort}
          onChange={(event) =>
            update({ sort: event.currentTarget.value as ShelterSearchQuery["sort"] })
          }
          className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2"
        >
          <option value="priority">운영·거리 우선</option>
          <option value="distance">가까운 거리순</option>
        </select>
      </label>
      <label
        className="t-caption col-span-2 flex min-h-11 items-center gap-2 self-end rounded-md border border-border px-3 font-bold"
        style={{ color: "var(--im-bank)" }}
      >
        <input
          type="checkbox"
          checked={query.imBank}
          onChange={(event) => update({ imBank: event.currentTarget.checked })}
          className="size-5"
        />{" "}
        iM뱅크 쉼터만
      </label>
    </section>
  );
};
