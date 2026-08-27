import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Database,
  MapPin,
  ShieldCheck,
  ThermometerSun,
  UserRoundCheck,
} from "lucide-react";

import { PaperShell } from "@/components/onjung/Shells";
import type { HeatAdvisory } from "@/lib/domain-types";
import type { LiveHomeSummary, PublicHomeWeather } from "@/lib/home/live-summary.server";

const loadHomeSummary = createServerFn({ method: "GET" }).handler(
  async (): Promise<LiveHomeSummary> => {
    const [{ setResponseHeader }, summary] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/lib/home/live-summary.server"),
    ]);
    setResponseHeader("cache-control", "public, max-age=300, stale-while-revalidate=900");

    try {
      return await summary.loadProductionLiveHomeSummary();
    } catch {
      return summary.unavailableLiveHomeSummary();
    }
  },
);

export const Route = createFileRoute("/")({
  loader: () => loadHomeSummary(),
  head: () => ({
    meta: [
      { title: "온중 溫證 — 누구나 쓰는 대구 폭염 안전 안내" },
      {
        name: "description",
        content: "대구의 현재 더위와 가까운 무더위쉼터를 누구나 로그인 없이 확인합니다.",
      },
      { property: "og:title", content: "온중 溫證 — 대구 폭염 안전 안내" },
      {
        property: "og:description",
        content: "오늘 더위와 가까운 쉼터를 확인하는 시민 폭염 안전 서비스.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const PUBLIC_ACTIONS = [
  {
    to: "/shelters" as const,
    step: "01",
    title: "가까운 쉼터 찾기",
    description: "현재 위치나 대구 주소를 기준으로 무더위쉼터와 그늘진 보행 경로를 찾습니다.",
    meta: "위치·주소 검색 · TMAP 보행 경로",
    icon: MapPin,
    accent: "var(--brand)",
    wash: "color-mix(in oklab, var(--brand) 8%, white)",
  },
] as const;

const ADVISORY_LABEL: Record<HeatAdvisory, string> = {
  NONE: "현재 발효 중인 폭염특보 없음",
  WATCH: "폭염주의보 발효 중",
  WARNING: "폭염경보 발효 중",
};

function formatKst(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "관측 시각 확인 지연";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function weatherSourceLabel(weather: PublicHomeWeather): string {
  return weather.source === "KMA_APIHUB_500M"
    ? "기상청 API허브 500m 관측"
    : "기상청 단기예보 보완값";
}

function Home() {
  const summary = Route.useLoaderData();

  return (
    <PaperShell wide>
      <main className="pb-10">
        <section className="relative isolate overflow-hidden rounded-[32px] border border-border bg-raised shadow-sh-1">
          <div
            className="pointer-events-none absolute -top-52 -left-40 -z-10 size-[34rem] rounded-full opacity-70 blur-3xl"
            style={{ background: "color-mix(in oklab, var(--brand) 17%, white)" }}
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -right-40 -bottom-52 -z-10 size-[32rem] rounded-full opacity-75 blur-3xl"
            style={{ background: "color-mix(in oklab, var(--heat-2) 18%, white)" }}
            aria-hidden="true"
          />

          <div className="grid gap-8 px-5 py-8 sm:px-9 sm:py-10 lg:px-12 lg:py-14 xl:grid-cols-[minmax(0,1.05fr)_minmax(21rem,.75fr)] xl:items-center">
            <header className="max-w-2xl">
              <p className="t-label flex items-center gap-2 font-bold text-brand">
                <ShieldCheck className="size-4" aria-hidden="true" />
                대구 시민 폭염 안전 서비스
              </p>
              <h1
                className="mt-4 font-display text-[clamp(2.5rem,6vw,4rem)] leading-[1.04] font-extrabold tracking-[-0.045em]"
                aria-label="온중 — 오늘 더위, 내 몸에 맞게 대비하세요"
              >
                <span className="sr-only">온중 — </span>
                오늘 더위,
                <br />
                <span className="sm:whitespace-nowrap">
                  내 몸에 맞게<span className="hidden sm:inline"> </span>
                  <br className="sm:hidden" />
                  대비하세요
                </span>
              </h1>
              <p className="t-body text-fg-2 mt-5 max-w-xl">
                복잡한 관제 화면 대신 지금 필요한 정보부터 보여드립니다. 현재 기상과 가까운
                쉼터를 누구나 바로 확인할 수 있습니다.
              </p>
              <a
                href="#public-actions"
                className="t-body-s mt-7 inline-flex min-h-12 items-center gap-2 rounded-full bg-foreground px-6 font-bold text-background transition-all hover:-translate-y-0.5 hover:shadow-sh-2"
              >
                지금 필요한 정보 선택하기
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </header>

            <WeatherPanel summary={summary} />
          </div>

          <div className="grid border-t border-border bg-white/55 sm:grid-cols-3">
            {[
              ["로그인 없이", "쉼터 정보 확인"],
              ["큰 글씨 모드", "어르신도 편하게"],
              ["실제 공개자료", "지연은 지연으로 표시"],
            ].map(([label, description], index) => (
              <div
                key={label}
                className={`px-5 py-4 sm:px-7 ${index > 0 ? "border-t border-border sm:border-t-0 sm:border-l" : ""}`}
              >
                <p className="t-caption font-bold text-foreground">{label}</p>
                <p className="t-caption text-fg-2 mt-0.5">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="public-actions" className="mt-12 scroll-mt-6" aria-labelledby="actions-title">
          <div className="max-w-2xl">
            <p className="t-caption font-bold text-brand">무엇이 필요하신가요?</p>
            <h2 id="actions-title" className="t-h1 mt-2">
              지금 할 일을 고르세요
            </h2>
            <p className="t-body-s text-fg-2 mt-2">
              회원가입이나 담당자 승인 없이 바로 시작할 수 있습니다.
            </p>
          </div>

          <div className="mt-6 max-w-3xl">
            {PUBLIC_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <a
                  key={action.to}
                  href={action.to}
                  aria-label={action.title}
                  className="group block min-w-0"
                >
                  <article
                    className="relative h-full min-h-72 overflow-hidden rounded-[28px] border border-border bg-raised p-6 transition duration-200 group-hover:-translate-y-1 group-hover:shadow-sh-3 sm:p-8"
                    style={{ background: `linear-gradient(145deg, ${action.wash}, white 62%)` }}
                  >
                    <div className="flex items-start justify-between gap-5">
                      <span
                        className="flex size-14 items-center justify-center rounded-2xl text-white shadow-sh-2"
                        style={{ background: action.accent }}
                      >
                        <Icon className="size-6" aria-hidden="true" />
                      </span>
                      <span
                        className="num text-5xl leading-none font-bold text-fg-3/25"
                        aria-hidden="true"
                      >
                        {action.step}
                      </span>
                    </div>
                    <h3 className="mt-8 font-display text-[clamp(1.55rem,4vw,2.15rem)] leading-tight font-bold tracking-[-0.025em]">
                      {action.title}
                    </h3>
                    <p className="t-body-s text-fg-2 mt-3 max-w-md">{action.description}</p>
                    <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
                      <span className="t-caption text-fg-2">{action.meta}</span>
                      <span
                        className="flex size-10 items-center justify-center rounded-full border border-border bg-white transition group-hover:translate-x-1"
                        style={{ color: action.accent }}
                        aria-hidden="true"
                      >
                        <ArrowRight className="size-4" />
                      </span>
                    </div>
                  </article>
                </a>
              );
            })}
          </div>
        </section>

        <section className="mt-12 grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,.75fr)]">
          <div className="rounded-[28px] border border-border bg-raised p-6 sm:p-8">
            <div className="flex items-center gap-2 text-brand">
              <Database className="size-5" aria-hidden="true" />
              <h2 className="t-h3 text-foreground">어떤 데이터를 연결하나요?</h2>
            </div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {[
                ["기상청", "현재 체감온도·기상특보"],
                ["대구시·Supabase", "무더위쉼터 위치·운영정보"],
              ].map(([source, detail]) => (
                <div key={source}>
                  <p className="t-caption font-bold">{source}</p>
                  <p className="t-caption text-fg-2 mt-1">{detail}</p>
                </div>
              ))}
            </div>
            <p className="t-caption text-fg-2 mt-6 border-t border-border pt-5">
              외부 기관 응답이 없을 때는 값을 추정하지 않고 지연 상태로 표시합니다.
            </p>
          </div>

          <aside className="relative overflow-hidden rounded-[28px] bg-foreground p-6 text-background sm:p-8">
            <UserRoundCheck className="size-7 opacity-75" aria-hidden="true" />
            <h2 className="t-h3 mt-6 text-background">돌봄 업무를 하고 계신가요?</h2>
            <p className="t-body-s mt-2 opacity-70">
              배정된 대상자와 대응 기록은 담당자 계정으로 확인할 수 있습니다.
            </p>
            <a
              href="/login"
              className="t-body-s mt-6 inline-flex min-h-12 items-center gap-2 rounded-full bg-background px-5 font-bold text-foreground"
            >
              돌봄 담당자 로그인
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          </aside>
        </section>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <p className="t-caption text-fg-2">2026 AI Blockchain Challenge in Daegu</p>
          <p className="t-caption flex items-center gap-1.5 text-fg-2">
            <ThermometerSun className="size-4" aria-hidden="true" />
            온중 溫證 · 오늘의 더위를 행동으로 연결합니다
          </p>
        </footer>
      </main>
    </PaperShell>
  );
}

function WeatherPanel({ summary }: { summary: LiveHomeSummary }) {
  const weather = summary.weather;
  return (
    <aside
      className="relative overflow-hidden rounded-[26px] border border-white/55 bg-foreground p-5 text-background shadow-sh-3 sm:p-7"
      aria-label="대구 현재 폭염 정보"
    >
      <div
        className="absolute inset-x-0 top-0 h-1.5"
        style={{ background: "linear-gradient(90deg, var(--brand), var(--heat-2), var(--heat-4))" }}
        aria-hidden="true"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="t-caption font-bold tracking-[0.12em] opacity-70">NOW · DAEGU</p>
        <ThermometerSun className="size-5 opacity-70" aria-hidden="true" />
      </div>

      {weather ? (
        <div className="mt-7">
          <p className="t-caption opacity-70">현재 체감온도</p>
          <p className="num mt-1 text-[clamp(3.75rem,10vw,5.5rem)] leading-none font-bold tracking-[-0.06em]">
            {weather.feelsLikeC.toFixed(1)}
            <span className="ml-1 text-[0.46em] tracking-normal">℃</span>
          </p>
          <p className="t-body-s mt-4 opacity-75">
            기온 {weather.airTemperatureC.toFixed(1)} ℃ · 습도 {weather.relativeHumidityPct}%
          </p>
          <p className="t-caption mt-2 opacity-60">
            {weatherSourceLabel(weather)} · {formatKst(weather.observedAt)} 기준
          </p>
        </div>
      ) : (
        <div className="mt-7 rounded-xl border border-white/15 bg-white/5 p-4" role="status">
          <p className="t-body-s font-bold">기상 관측을 일시적으로 불러오지 못했습니다</p>
          <p className="t-caption mt-1 opacity-65">잠시 후 새로고침해 주세요.</p>
        </div>
      )}

      <div className="mt-7 grid gap-4 border-t border-white/15 pt-5 sm:grid-cols-2">
        <div>
          <p className="t-caption opacity-60">기상특보</p>
          <p className="t-body-s mt-1 font-bold">
            {summary.heatAdvisory === null
              ? "특보 확인 지연"
              : ADVISORY_LABEL[summary.heatAdvisory]}
          </p>
        </div>
        <div>
          <p className="t-caption opacity-60">대구 무더위쉼터</p>
          <p className="t-body-s mt-1 font-bold">
            {summary.shelterCount === null
              ? "쉼터 수 집계 지연"
              : `대구 무더위쉼터 ${summary.shelterCount.toLocaleString("ko-KR")}곳`}
          </p>
        </div>
      </div>
    </aside>
  );
}
