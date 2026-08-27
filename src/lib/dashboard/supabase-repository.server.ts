import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ATTEST_STATES, HEAT_ADVISORIES, RISK_LEVELS, type RiskLevel } from "@/lib/domain-types";
import { AppError } from "@/lib/error-dto";
import { maskSubjectName } from "@/lib/subjects/dto";

import type { DashboardRepository } from "./repository";
import { DAEGU_GU, type DashboardSearch } from "./search";
import type {
  DashboardCareEvent,
  DashboardSnapshot,
  DashboardSubject,
  DashboardWeather,
} from "./types";

const UUID = z.string().uuid();
const EAS_UID = z.string().regex(/^0x[0-9a-f]{64}$/iu);

const scopedSubjectRowsSchema = z.array(
  z
    .object({
      id: UUID,
      lives_alone: z.boolean(),
    })
    .strict(),
);

const privateSubjectRowsSchema = z.array(
  z
    .object({
      id: UUID,
      name: z.string().min(1).max(80),
      birth_year: z.number().int().min(1900).max(2100),
      address: z.string().min(1),
    })
    .strict(),
);

const riskRowsSchema = z.array(
  z
    .object({
      subject_id: UUID,
      weather_snapshot_id: z.number().int().positive(),
      hri: z.number().int().min(0).max(100),
      level: z.enum(RISK_LEVELS),
      reasons: z.array(z.string()).min(1).max(3),
      computed_at: z.string().datetime({ offset: true }),
    })
    .strict(),
);

const weatherRowsSchema = z.array(
  z
    .object({
      id: z.number().int().positive(),
      feels_like_c: z.number().finite(),
      advisory: z.enum(HEAT_ADVISORIES),
      observed_at: z.string().datetime({ offset: true }),
      is_partial: z.boolean(),
      is_stale: z.boolean(),
    })
    .strict(),
);

const careEventRowsSchema = z.array(
  z
    .object({
      id: UUID,
      subject_id: UUID,
      alert_transition_id: UUID.nullable(),
      event_type: z.enum(["VISIT", "SHELTER_CHECKIN", "ALERT_SENT"]),
      risk_level: z.enum(RISK_LEVELS),
      hri: z.number().int().min(0).max(100),
      occurred_at: z.string().datetime({ offset: true }),
      attestation_state: z.enum(ATTEST_STATES),
      attestation_uid: EAS_UID.nullable(),
    })
    .strict(),
);

const transitionRowsSchema = z.array(
  z
    .object({
      id: UUID,
      subject_id: UUID,
      to_level: z.literal("L4"),
      occurred_at: z.string().datetime({ offset: true }),
    })
    .strict(),
);

const acknowledgementRowsSchema = z.array(z.object({ alert_transition_id: UUID }).strict());

const LEVEL_RANK: Record<RiskLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
const EVENT_LABEL = {
  VISIT: "생활지원사 방문",
  SHELTER_CHECKIN: "쉼터 체크인",
  ALERT_SENT: "보호자 알림 발송",
} as const;
const DISTRICTS = new Set<string>(DAEGU_GU.filter((gu) => gu !== "전체"));

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

function dashboardFailure(): AppError<"SERVER_TEMPORARY"> {
  return new AppError("SERVER_TEMPORARY");
}

function parseRows<T>(result: QueryResult, schema: z.ZodType<T>): T {
  if (result.error) throw dashboardFailure();
  const parsed = schema.safeParse(result.data ?? []);
  if (!parsed.success) throw dashboardFailure();
  return parsed.data;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function latestRisks(rows: z.infer<typeof riskRowsSchema>) {
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = latest.get(row.subject_id);
    if (!current || Date.parse(row.computed_at) > Date.parse(current.computed_at)) {
      latest.set(row.subject_id, row);
    }
  }
  return latest;
}

function districtAndNeighborhood(address: string): {
  gu: string;
  locationLabel: string;
} {
  const tokens = address.trim().split(/\s+/);
  const districtIndex = tokens.findIndex((token) => DISTRICTS.has(token));
  if (districtIndex < 0) return { gu: "미확인", locationLabel: "지역 미확인" };

  const gu = tokens[districtIndex]!;
  const neighborhood = tokens
    .slice(districtIndex + 1)
    .find((token) => /(?:동|읍|면|가)$/.test(token));
  return {
    gu,
    locationLabel: neighborhood ? `${gu} ${neighborhood}` : gu,
  };
}

function kstYear(now: Date): number {
  const year = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(now);
  return Number(year);
}

function compareSubjects(
  left: DashboardSubject,
  right: DashboardSubject,
  search: DashboardSearch,
): number {
  const direction = search.order === "asc" ? 1 : -1;
  let comparison = 0;
  if (search.sort === "age") comparison = left.age - right.age;
  else if (search.sort === "updated") {
    comparison = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  } else comparison = left.hri - right.hri;
  return comparison === 0 ? left.id.localeCompare(right.id) : comparison * direction;
}

function topbarWeather(
  gu: DashboardSearch["gu"],
  subjects: readonly DashboardSubject[],
  weatherBySubject: ReadonlyMap<string, DashboardWeather>,
): DashboardWeather | null {
  const newest = subjects
    .map((subject) => weatherBySubject.get(subject.id))
    .filter((weather): weather is DashboardWeather => weather !== undefined)
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
  return newest ? { ...newest, gu: gu === "전체" ? "대구 전체" : gu } : null;
}

export interface SupabaseDashboardRepositoryOptions {
  now?: () => Date;
}

/**
 * Reads authorization scope exclusively through the session client. The admin
 * client may only dereference subject/weather IDs that first survived RLS.
 */
export function createSupabaseDashboardRepository(
  sessionClient: SupabaseClient,
  adminClient: SupabaseClient,
  options: SupabaseDashboardRepositoryOptions = {},
): DashboardRepository {
  const now = options.now ?? (() => new Date());

  return {
    async read({ actorId, search }) {
      const scopedResult = await sessionClient
        .from("subjects")
        .select("id,lives_alone")
        .order("id", { ascending: true });
      const scopedSubjects = parseRows(scopedResult, scopedSubjectRowsSchema);
      const allowedSubjectIds = unique(scopedSubjects.map((row) => row.id));

      if (allowedSubjectIds.length === 0) {
        return {
          source: "SUPABASE",
          filter: search,
          summary: { total: 0, averageHri: 0, byLevel: { L2: 0, L3: 0, L4: 0 } },
          weather: null,
          urgentSubjects: [],
          mapSubjects: [],
          careEvents: [],
          unreadL4Alerts: [],
          missingSources: [],
          fetchedAt: now().toISOString(),
        };
      }

      const [risksResult, eventsResult, transitionsResult, privateSubjectsResult] =
        await Promise.all([
          sessionClient
            .from("risk_snapshots")
            .select("subject_id,weather_snapshot_id,hri,level,reasons,computed_at")
            .in("subject_id", allowedSubjectIds)
            .order("computed_at", { ascending: false })
            .limit(5000),
          sessionClient
            .from("care_events")
            .select(
              "id,subject_id,alert_transition_id,event_type,risk_level,hri,occurred_at,attestation_state,attestation_uid",
            )
            .in("subject_id", allowedSubjectIds)
            .order("occurred_at", { ascending: false })
            .limit(100),
          sessionClient
            .from("alert_transitions")
            .select("id,subject_id,to_level,occurred_at")
            .in("subject_id", allowedSubjectIds)
            .eq("to_level", "L4")
            .order("occurred_at", { ascending: false })
            .limit(100),
          adminClient
            .from("subjects")
            .select("id,name,birth_year,address")
            .in("id", allowedSubjectIds),
        ]);

      const riskRows = parseRows(risksResult, riskRowsSchema);
      const eventRows = parseRows(eventsResult, careEventRowsSchema);
      const transitionRows = parseRows(transitionsResult, transitionRowsSchema);
      const privateSubjectRows = parseRows(privateSubjectsResult, privateSubjectRowsSchema);
      if (privateSubjectRows.length !== allowedSubjectIds.length) throw dashboardFailure();

      const latestRiskBySubject = latestRisks(riskRows);
      const weatherIds = unique(
        [...latestRiskBySubject.values()].map((row) => row.weather_snapshot_id),
      );
      const transitionIds = transitionRows.map((row) => row.id);
      const [weatherResult, acknowledgementsResult] = await Promise.all([
        weatherIds.length > 0
          ? adminClient
              .from("weather_snapshots")
              .select("id,feels_like_c,advisory,observed_at,is_partial,is_stale")
              .in("id", weatherIds)
          : Promise.resolve({ data: [], error: null }),
        transitionIds.length > 0
          ? sessionClient
              .from("alert_transition_acknowledgements")
              .select("alert_transition_id")
              .eq("profile_id", actorId)
              .in("alert_transition_id", transitionIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const weatherRows = parseRows(weatherResult, weatherRowsSchema);
      const acknowledgementRows = parseRows(acknowledgementsResult, acknowledgementRowsSchema);
      if (weatherRows.length !== weatherIds.length) throw dashboardFailure();

      const scopedById = new Map(scopedSubjects.map((row) => [row.id, row]));
      const weatherById = new Map(weatherRows.map((row) => [row.id, row]));
      const weatherBySubject = new Map<string, DashboardWeather>();
      const allRiskSubjects: DashboardSubject[] = [];
      const currentYear = kstYear(now());

      for (const privateRow of privateSubjectRows) {
        const scoped = scopedById.get(privateRow.id);
        const risk = latestRiskBySubject.get(privateRow.id);
        if (!scoped || !risk) continue;
        const weather = weatherById.get(risk.weather_snapshot_id);
        if (!weather) throw dashboardFailure();
        const place = districtAndNeighborhood(privateRow.address);
        const age = currentYear - privateRow.birth_year;
        if (!Number.isInteger(age) || age < 0 || age > 130) throw dashboardFailure();

        const weatherDto: DashboardWeather = {
          gu: place.gu,
          feelsLikeC: weather.feels_like_c,
          advisory: weather.advisory,
          observedAt: weather.observed_at,
          isPartial: weather.is_partial,
          isStale: weather.is_stale,
        };
        weatherBySubject.set(privateRow.id, weatherDto);
        allRiskSubjects.push({
          id: privateRow.id,
          maskedName: maskSubjectName(privateRow.name),
          age,
          livesAlone: scoped.lives_alone,
          gu: place.gu,
          locationLabel: place.locationLabel,
          level: risk.level,
          hri: risk.hri,
          feelsLikeC: weather.feels_like_c,
          reasons: risk.reasons,
          updatedAt: risk.computed_at,
        });
      }

      const districtSubjects = allRiskSubjects.filter(
        (subject) => search.gu === "전체" || subject.gu === search.gu,
      );
      const urgentSubjects = districtSubjects
        .filter((subject) => LEVEL_RANK[subject.level] >= LEVEL_RANK[search.level])
        .sort((left, right) => compareSubjects(left, right, search))
        .slice(0, 10);
      const districtIds = new Set(districtSubjects.map((subject) => subject.id));
      const subjectById = new Map(allRiskSubjects.map((subject) => [subject.id, subject]));
      const eventByTransition = new Map(
        eventRows
          .filter((event) => event.alert_transition_id !== null)
          .map((event) => [event.alert_transition_id!, event]),
      );
      const acknowledged = new Set(acknowledgementRows.map((row) => row.alert_transition_id));

      const careEvents: DashboardCareEvent[] = eventRows
        .filter((event) => districtIds.has(event.subject_id))
        .slice(0, 10)
        .map((event) => ({
          id: event.id,
          attestationUid: event.attestation_uid,
          typeLabel: EVENT_LABEL[event.event_type],
          occurredAt: event.occurred_at,
          attest: event.attestation_state,
        }));

      const missingSources: string[] = [];
      if (privateSubjectRows.some((subject) => !latestRiskBySubject.has(subject.id))) {
        missingSources.push("위험도");
      }
      if (
        districtSubjects.some((subject) => {
          const weather = weatherBySubject.get(subject.id);
          return weather?.isPartial || weather?.isStale;
        })
      ) {
        missingSources.push("기상");
      }

      const snapshot: DashboardSnapshot = {
        source: "SUPABASE",
        filter: search,
        summary: {
          total: districtSubjects.length,
          averageHri:
            districtSubjects.length === 0
              ? 0
              : Math.round(
                  districtSubjects.reduce((sum, subject) => sum + subject.hri, 0) /
                    districtSubjects.length,
                ),
          byLevel: {
            L2: districtSubjects.filter((subject) => subject.level === "L2").length,
            L3: districtSubjects.filter((subject) => subject.level === "L3").length,
            L4: districtSubjects.filter((subject) => subject.level === "L4").length,
          },
        },
        weather: topbarWeather(search.gu, districtSubjects, weatherBySubject),
        urgentSubjects,
        mapSubjects: urgentSubjects,
        careEvents,
        unreadL4Alerts: transitionRows
          .filter(
            (transition) =>
              districtIds.has(transition.subject_id) && !acknowledged.has(transition.id),
          )
          .map((transition) => {
            const subject = subjectById.get(transition.subject_id);
            if (!subject) throw dashboardFailure();
            return {
              transitionId: transition.id,
              subjectId: subject.id,
              maskedName: subject.maskedName,
              age: subject.age,
              hri: eventByTransition.get(transition.id)?.hri ?? subject.hri,
              occurredAt: transition.occurred_at,
            };
          }),
        missingSources,
        fetchedAt: now().toISOString(),
      };
      return snapshot;
    },

    async acknowledgeL4({ actorId, transitionId }) {
      const result = await sessionClient.from("alert_transition_acknowledgements").upsert(
        {
          alert_transition_id: transitionId,
          profile_id: actorId,
          acknowledged_at: now().toISOString(),
        },
        {
          onConflict: "alert_transition_id,profile_id",
          ignoreDuplicates: true,
        },
      );
      if (result.error) throw dashboardFailure();
    },
  };
}
