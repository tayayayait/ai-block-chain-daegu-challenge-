import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import type { HeatAdvisory } from "@/lib/domain-types";

const SENIOR_STORAGE_KEY = "onjung.senior";

function storedSeniorMode(): boolean | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const stored = window.localStorage.getItem(SENIOR_STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Storage can be disabled by privacy mode or browser policy. The
    // serializable default remains usable in that case.
  }

  return undefined;
}

function initialSeniorMode(serverValue: boolean | undefined, fallback: boolean): boolean {
  return serverValue ?? storedSeniorMode() ?? fallback;
}

const SENIOR_BOOTSTRAP = String.raw`(()=>{const s=document.currentScript;const r=s&&s.parentElement;if(!r)return;const server=r.dataset.seniorServer;let on;if(server==="true"||server==="false"){on=server==="true";}else{try{const v=localStorage.getItem("onjung.senior");on=v==="1"?true:v==="0"?false:r.dataset.seniorDefault==="true";}catch{on=r.dataset.seniorDefault==="true";}}r.dataset.senior=String(on);r.classList.toggle("senior",on);})();`;

const NAV = [
  { to: "/dashboard", label: "대시보드", icon: "▣" },
  { to: "/dashboard", label: "대상자 명단", icon: "▤" },
  { to: "/shelters", label: "쉼터 지도", icon: "▦" },
] as const;

export interface ShadeWeather {
  gu: string;
  feelsLikeC: number;
  advisory: HeatAdvisory;
  observedAt: string;
  isPartial: boolean;
  isStale: boolean;
}

const ADVISORY_LABEL: Record<HeatAdvisory, string> = {
  NONE: "폭염특보 없음",
  WATCH: "폭염주의보 발효 중",
  WARNING: "폭염경보 발효 중",
};

function formatWeatherTime(observedAt: string): string {
  const date = new Date(observedAt);
  if (!Number.isFinite(date.getTime())) return "시각 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Shade 표면 — 관제(다크). 1024px 미만은 미지원 안내. */
export function ShadeShell({
  children,
  weather,
}: {
  children: ReactNode;
  weather?: ShadeWeather | null;
}) {
  const freshness = weather?.isStale
    ? "이전 유효값"
    : weather?.isPartial
      ? "일부 데이터"
      : "실시간 관측";

  return (
    <div className="shade bg-background text-foreground min-h-dvh">
      <div className="p-6 lg:hidden">
        <p className="t-h3">관제 화면은 태블릿 가로 이상에서 이용해 주세요</p>
        <p className="text-fg-2 t-body-s mt-2">
          최소 1024px 폭이 필요합니다. 시민 화면은{" "}
          <a href="/shelters" className="underline" style={{ color: "var(--brand)" }}>
            쉼터 지도
          </a>
          에서 이용하세요.
        </p>
      </div>

      <div className="hidden lg:block">
        <header
          className="border-border bg-raised fixed inset-x-0 top-0 flex h-16 items-center gap-6 border-b px-6"
          style={{ zIndex: 200 }}
        >
          <span className="t-h3" style={{ color: "var(--brand)" }}>
            온중 <span className="t-caption text-fg-3">溫證</span>
          </span>
          <span className="text-fg-2 t-body-s">
            {weather?.gu.startsWith("대구") ? weather.gu : `대구 ${weather?.gu ?? "전체"}`}
          </span>
          <span className="num t-body-s">
            {weather ? `체감 ${weather.feelsLikeC.toFixed(1)}\u00a0℃` : "기상 데이터 준비 중"}
          </span>
          <span
            className="t-caption rounded-full px-2.5 py-1 font-semibold"
            style={{
              backgroundColor: weather
                ? "color-mix(in oklab, var(--heat-3) 18%, transparent)"
                : "var(--overlay)",
              color: weather ? "var(--heat-3)" : "var(--fg-2)",
            }}
          >
            {weather ? ADVISORY_LABEL[weather.advisory] : "관측 대기"}
          </span>
          <span className="text-fg-3 t-caption ml-auto">
            {weather
              ? `${formatWeatherTime(weather.observedAt)} 기준 · ${freshness}`
              : "갱신 대기 중"}
          </span>
        </header>

        <nav
          className="border-border bg-raised fixed top-16 bottom-0 left-0 w-[72px] border-r p-3 xl:w-60"
          aria-label="주요 메뉴"
        >
          <ul className="space-y-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <a
                  href={n.to}
                  className="text-fg-2 hover:bg-overlay hover:text-foreground flex h-11 items-center gap-3 rounded-md px-3 transition-colors duration-100"
                >
                  <span aria-hidden="true">{n.icon}</span>
                  <span className="t-body-s hidden xl:inline">{n.label}</span>
                  <span className="sr-only xl:hidden">{n.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="mx-auto max-w-[1600px] pt-16 pl-[72px] xl:pl-60">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Paper 표면 — 시민(라이트) + 시니어 모드 토글 */
export function PaperShell({
  children,
  back,
  backLabel = "뒤로",
  showSeniorToggle = true,
  serverSeniorMode,
  defaultSeniorMode = false,
  wide = false,
}: {
  children: ReactNode;
  back?: string;
  backLabel?: string;
  showSeniorToggle?: boolean;
  serverSeniorMode?: boolean;
  defaultSeniorMode?: boolean;
  wide?: boolean;
}) {
  const [senior, setSenior] = useState(() =>
    initialSeniorMode(serverSeniorMode, defaultSeniorMode),
  );

  useEffect(() => {
    if (serverSeniorMode === undefined) return;

    setSenior(serverSeniorMode);
    try {
      window.localStorage.setItem(SENIOR_STORAGE_KEY, serverSeniorMode ? "1" : "0");
    } catch {
      // UI state remains authoritative when persistence is unavailable.
    }
  }, [serverSeniorMode]);

  const toggle = () => {
    const next = !senior;
    setSenior(next);
    try {
      window.localStorage.setItem(SENIOR_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // The control must remain usable even when storage quota/policy fails.
    }
  };

  return (
    <div
      className={`bg-background text-foreground min-h-dvh ${senior ? "senior" : ""}`}
      data-senior={String(senior)}
      data-senior-server={serverSeniorMode === undefined ? undefined : String(serverSeniorMode)}
      data-senior-default={String(defaultSeniorMode)}
      suppressHydrationWarning
    >
      <script
        data-senior-bootstrap
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: SENIOR_BOOTSTRAP }}
      />
      <div
        className={`mx-auto w-full px-4 pt-4 pb-10 ${wide ? "max-w-[1280px]" : "max-w-[768px]"}`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          {back ? (
            <Link
              to={back}
              className="t-body-s text-fg-2 inline-flex items-center gap-1"
              style={{ minHeight: "var(--tap-min)" }}
            >
              ← {backLabel}
            </Link>
          ) : (
            <Link
              to="/"
              className="t-caption inline-flex items-center font-bold"
              style={{ color: "var(--brand)", minHeight: "var(--tap-min)" }}
            >
              온중 溫證
            </Link>
          )}
          {showSeniorToggle && (
            <button
              type="button"
              onClick={toggle}
              aria-pressed={senior}
              className="t-caption border-border rounded-full border px-3 py-1.5 font-semibold"
              style={
                senior
                  ? {
                      backgroundColor: "var(--brand)",
                      color: "#fff",
                      minHeight: "var(--tap-min)",
                    }
                  : { color: "var(--fg-2)", minHeight: "var(--tap-min)" }
              }
            >
              큰 글씨 모드 {senior ? "켜짐" : "꺼짐"}
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Card({
  children,
  className = "",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`bg-raised border-border relative rounded-lg border p-4 sm:p-6 ${interactive ? "transition-shadow duration-100 hover:shadow-sh-2" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="t-h3">{children}</h2>
      {action}
    </div>
  );
}
