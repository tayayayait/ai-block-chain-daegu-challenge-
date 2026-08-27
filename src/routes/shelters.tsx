import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { PaperShell } from "@/components/onjung/Shells";
import type { DepartureComparisonUiDto } from "@/components/routing";
import { ShelterExplorer } from "@/components/shelters/ShelterExplorer";
import type { NaverAddressCandidate } from "@/integrations/naver/geocode.server";
import { protectedLocationPath, requireSubjectRouteAccess } from "@/lib/auth/route-access";
import { createPublicError, type PublicErrorDto } from "@/lib/error-dto";
import {
  DEFAULT_PUBLIC_SHELTER_ORIGIN,
  inferPublicShelterOriginSource,
  ShelterSearchQuerySchema,
  type ShelterOriginSource,
  type ShelterSearchQuery,
} from "@/lib/shelters/search-schema";
import type { ShelterSearchResult } from "@/lib/shelters/service.server";

const AddressSearchSchema = z.object({ query: z.string().trim().min(2).max(120) }).strict();
const SubjectIdSchema = z.string().uuid();
const PrivateShelterFiltersSchema = ShelterSearchQuerySchema.omit({ lat: true, lng: true });
const SubjectShelterSearchSchema = PrivateShelterFiltersSchema.extend({
  subjectId: SubjectIdSchema,
}).strict();
const AlertShelterSearchSchema = PrivateShelterFiltersSchema.extend({
  scope: z.literal("alert"),
}).strict();
const ShelterRouteSearchSchema = z.union([
  ShelterSearchQuerySchema,
  SubjectShelterSearchSchema,
  AlertShelterSearchSchema,
]);
type ShelterRouteSearch = z.infer<typeof ShelterRouteSearchSchema>;
const RouteRequestSchema = z
  .object({
    shelterId: z.string().regex(/^DG-\d{4}$/u),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
const SubjectRouteRequestSchema = z
  .object({ shelterId: z.string().regex(/^DG-\d{4}$/u), subjectId: SubjectIdSchema })
  .strict();
const AlertRouteRequestSchema = z
  .object({ shelterId: z.string().regex(/^DG-\d{4}$/u), scope: z.literal("alert") })
  .strict();
const ShadeRouteRequestSchema = z.union([
  RouteRequestSchema,
  SubjectRouteRequestSchema,
  AlertRouteRequestSchema,
]);
const CheckInRequestSchema = z
  .object({
    subjectId: SubjectIdSchema,
    shelterId: z.string().regex(/^DG-\d{4}$/u),
    clientRequestId: z.string().uuid(),
  })
  .strict();
const AlertCheckInRequestSchema = z
  .object({
    scope: z.literal("alert"),
    shelterId: z.string().regex(/^DG-\d{4}$/u),
    clientRequestId: z.string().uuid(),
  })
  .strict();

function isSubjectSearch(
  search: ShelterRouteSearch,
): search is z.infer<typeof SubjectShelterSearchSchema> {
  return "subjectId" in search;
}

function isAlertSearch(
  search: ShelterRouteSearch,
): search is z.infer<typeof AlertShelterSearchSchema> {
  return "scope" in search && search.scope === "alert";
}

function privateSearchQuery(
  filters: z.infer<typeof PrivateShelterFiltersSchema>,
  origin: Readonly<{ latitude: number; longitude: number }>,
): ShelterSearchQuery {
  return ShelterSearchQuerySchema.parse({
    lat: origin.latitude,
    lng: origin.longitude,
    radius: filters.radius,
    gu: filters.gu,
    imBank: filters.imBank,
    open: filters.open,
    sort: filters.sort,
    limit: filters.limit,
  });
}

function redactPrivateOrigin(result: ShelterSearchResult): ShelterSearchResult {
  return Object.freeze({
    ...result,
    query: ShelterSearchQuerySchema.parse({
      ...result.query,
      lat: DEFAULT_PUBLIC_SHELTER_ORIGIN.lat,
      lng: DEFAULT_PUBLIC_SHELTER_ORIGIN.lng,
    }),
  });
}

async function loadActualShelterCount(): Promise<number | null> {
  try {
    const { createAdminSupabaseClient } = await import("@/lib/supabase/admin.server");
    const response = await createAdminSupabaseClient().from("shelters").select("id", {
      count: "exact",
      head: true,
    });

    return response.error === null &&
      typeof response.count === "number" &&
      Number.isSafeInteger(response.count) &&
      response.count >= 0
      ? response.count
      : null;
  } catch {
    return null;
  }
}

async function attachShelterMetadata(
  result: Promise<ShelterSearchResult>,
  originSource: ShelterOriginSource,
) {
  const [resolvedResult, totalShelterCount] = await Promise.all([result, loadActualShelterCount()]);

  return {
    result: resolvedResult,
    totalShelterCount,
    originSource,
    now: new Date().toISOString(),
  } as const;
}

const loadShelters = createServerFn({ method: "GET" })
  .validator((input: unknown) => ShelterRouteSearchSchema.parse(input))
  .handler(async ({ data }) => {
    const [{ setResponseHeader }, { searchShelters }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/lib/shelters/service.server"),
    ]);
    if (isSubjectSearch(data)) {
      const { authorizeSubjectShelterRequest } =
        await import("@/lib/shelters/subject-request.server");
      const authorized = await authorizeSubjectShelterRequest({ subjectId: data.subjectId });
      const query = privateSearchQuery(data, authorized.origin);
      return attachShelterMetadata(
        searchShelters(query).then(redactPrivateOrigin),
        "SUBJECT_LOCATION",
      );
    }
    if (isAlertSearch(data)) {
      const { authorizeAlertSubjectShelterRequest } =
        await import("@/lib/shelters/alert-subject-request.server");
      const authorized = await authorizeAlertSubjectShelterRequest();
      const query = privateSearchQuery(data, authorized.origin);
      return attachShelterMetadata(
        searchShelters(query).then(redactPrivateOrigin),
        "ALERT_SUBJECT_LOCATION",
      );
    }
    setResponseHeader("cache-control", "public, max-age=0, must-revalidate");
    return attachShelterMetadata(searchShelters(data), inferPublicShelterOriginSource(data));
  });

const searchLocationAddress = createServerFn({ method: "GET" })
  .validator((input: unknown) => AddressSearchSchema.parse(input))
  .handler(async ({ data }) => {
    const [{ createSmartLocationSearcherFromEnv }] = await Promise.all([
      import("@/integrations/location-search/location-search.server"),
    ]);
    const searcher = createSmartLocationSearcherFromEnv();
    return searcher.search(data.query);
  });

const loadDepartureComparison = createServerFn({ method: "POST" })
  .validator((input: unknown) => ShadeRouteRequestSchema.parse(input))
  .handler(async ({ data }): Promise<DepartureComparisonUiDto> => {
    const [{ getShelterById }, { planDepartureComparison }] = await Promise.all([
      import("@/lib/shelters/lookup.server"),
      import("@/lib/routing/departure-planner.server"),
    ]);
    const shelter = await getShelterById(data.shelterId);
    const origin =
      "subjectId" in data
        ? (
            await (
              await import("@/lib/shelters/subject-request.server")
            ).authorizeSubjectShelterRequest({ subjectId: data.subjectId })
          ).origin
        : "scope" in data
          ? (
              await (
                await import("@/lib/shelters/alert-subject-request.server")
              ).authorizeAlertSubjectShelterRequest()
            ).origin
          : { latitude: data.latitude, longitude: data.longitude };
    return planDepartureComparison({
      start: [origin.longitude, origin.latitude],
      destinationPosition: [shelter.longitude, shelter.latitude],
      shelterId: shelter.id,
      destination: {
        name: shelter.name,
        longitude: shelter.longitude,
        latitude: shelter.latitude,
      },
    });
  });

const submitSubjectShelterCheckIn = createServerFn({ method: "POST" })
  .validator((input: unknown) => CheckInRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const [
      { authorizeSubjectShelterRequest },
      { submitShelterCheckIn },
      { createSupabaseCheckInRepository },
      { getServerEnv },
    ] = await Promise.all([
      import("@/lib/shelters/subject-request.server"),
      import("@/lib/routing/check-in-service.server"),
      import("@/lib/routing/check-in-repository.server"),
      import("@/lib/env.server"),
    ]);
    const authorized = await authorizeSubjectShelterRequest({ subjectId: data.subjectId });
    const environment = getServerEnv();
    return submitShelterCheckIn(
      data,
      { kind: "STAFF_SESSION", userId: authorized.userId },
      {
        authorizeSubject: authorized.authorizeSubject,
        resolveSubjectSession: async () => null,
        repository: createSupabaseCheckInRepository(),
        actorHashSecret: environment.SUBJECT_HASH_SECRET ?? "",
      },
    );
  });

const submitAlertShelterCheckIn = createServerFn({ method: "POST" })
  .validator((input: unknown) => AlertCheckInRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const [
      { authorizeAlertSubjectShelterRequest },
      { submitShelterCheckIn },
      { createSupabaseCheckInRepository },
      { getServerEnv },
    ] = await Promise.all([
      import("@/lib/shelters/alert-subject-request.server"),
      import("@/lib/routing/check-in-service.server"),
      import("@/lib/routing/check-in-repository.server"),
      import("@/lib/env.server"),
    ]);
    const authorized = await authorizeAlertSubjectShelterRequest();
    const environment = getServerEnv();
    return submitShelterCheckIn(
      {
        subjectId: authorized.subjectId,
        shelterId: data.shelterId,
        clientRequestId: data.clientRequestId,
      },
      { kind: "SUBJECT_SESSION", accessToken: authorized.accessToken },
      {
        authorizeSubject: async () => {
          throw new Error("UNREACHABLE_STAFF_AUTHORIZATION");
        },
        resolveSubjectSession: authorized.resolveSubjectSession,
        repository: createSupabaseCheckInRepository(),
        actorHashSecret: environment.SUBJECT_HASH_SECRET ?? "",
      },
    );
  });

type ShelterRouteData =
  | Readonly<{
      kind: "READY";
      result: ShelterSearchResult;
      totalShelterCount: number | null;
      originSource: ShelterOriginSource;
      now: string;
    }>
  | Readonly<{ kind: "ERROR"; query: ShelterRouteSearch; error: PublicErrorDto }>;

export const Route = createFileRoute("/shelters")({
  validateSearch: (search) => ShelterRouteSearchSchema.parse(search),
  beforeLoad: async ({ location, search }) => {
    if (isSubjectSearch(search)) {
      await requireSubjectRouteAccess({
        subjectId: search.subjectId,
        nextPath: protectedLocationPath(location),
      });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }): Promise<ShelterRouteData> => {
    try {
      const loaded = await loadShelters({ data: deps });
      return { kind: "READY", ...loaded };
    } catch {
      return { kind: "ERROR", query: deps, error: createPublicError("SERVER_TEMPORARY") };
    }
  },
  head: () => ({
    meta: [
      { title: "가까운 무더위쉼터 — 온중 溫證" },
      {
        name: "description",
        content: "대구 무더위쉼터를 거리·운영상태·iM뱅크 여부로 찾아봅니다.",
      },
    ],
  }),
  component: SheltersRoute,
});

function SheltersRoute() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const subjectId = isSubjectSearch(search) ? search.subjectId : null;
  const alertScoped = isAlertSearch(search);
  const privateScoped = subjectId !== null || alertScoped;

  const updateQuery = (query: ShelterSearchQuery) => {
    void navigate({
      search: !privateScoped
        ? ShelterSearchQuerySchema.parse(query)
        : subjectId !== null
          ? SubjectShelterSearchSchema.parse({
              subjectId,
              radius: query.radius,
              gu: query.gu,
              imBank: query.imBank,
              open: query.open,
              sort: query.sort,
              limit: query.limit,
            })
          : AlertShelterSearchSchema.parse({
              scope: "alert",
              radius: query.radius,
              gu: query.gu,
              imBank: query.imBank,
              open: query.open,
              sort: query.sort,
              limit: query.limit,
            }),
    });
  };

  const findAddress = async (query: string): Promise<readonly NaverAddressCandidate[]> => {
    try {
      return await searchLocationAddress({ data: { query } });
    } catch {
      return [];
    }
  };

  const requestDepartureComparison = async (input: z.infer<typeof RouteRequestSchema>) =>
    loadDepartureComparison({
      data: !privateScoped
        ? input
        : subjectId !== null
          ? {
              shelterId: input.shelterId,
              subjectId,
            }
          : { shelterId: input.shelterId, scope: "alert" },
    });

  const requestCheckIn = !privateScoped
    ? undefined
    : subjectId !== null
      ? (input: { shelterId: string; clientRequestId: string }) =>
          submitSubjectShelterCheckIn({ data: { ...input, subjectId } })
      : (input: { shelterId: string; clientRequestId: string }) =>
          submitAlertShelterCheckIn({ data: { ...input, scope: "alert" } });

  return (
    <PaperShell wide>
      {data.kind === "READY" ? (
        <ShelterExplorer
          result={data.result}
          totalShelterCount={data.totalShelterCount}
          originSource={data.originSource}
          now={data.now}
          onQueryChange={updateQuery}
          searchAddress={findAddress}
          requestDepartureComparison={requestDepartureComparison}
          subjectScoped={privateScoped}
          {...(requestCheckIn === undefined ? {} : { requestCheckIn })}
        />
      ) : (
        <main className="py-10">
          <section className="border-danger/40 bg-raised rounded-xl border p-6" role="alert">
            <h1 className="t-h2">쉼터 정보를 불러오지 못했습니다</h1>
            <p className="t-body-s text-fg-2 mt-3">{data.error.userMessage}</p>
            <button
              type="button"
              className="btn-primary mt-5 min-h-[var(--tap-min)] px-5"
              onClick={() => window.location.reload()}
            >
              다시 시도
            </button>
          </section>
        </main>
      )}
    </PaperShell>
  );
}
