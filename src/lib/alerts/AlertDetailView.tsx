import type { AlertDetailDto } from "./detail";

const formatOccurredAt = (value: string): string =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

export const AlertDetailView = ({ detail }: { detail: AlertDetailDto }) => (
  <main className="mx-auto max-w-xl pb-12">
    <p
      className="t-caption inline-flex rounded-full px-3 py-1.5 font-bold"
      style={{ background: "var(--overlay)", color: "var(--fg-2)" }}
    >
      DEMO · 실제 알림은 발송되지 않습니다
    </p>

    <section
      className="mt-4 overflow-hidden rounded-xl border-2 bg-raised shadow-sh-2"
      style={{ borderColor: "var(--heat-4)" }}
      aria-labelledby="alert-title"
    >
      <div className="p-6 sm:p-8">
        <p className="t-caption font-bold" style={{ color: "var(--heat-4)" }}>
          위험 {detail.riskLevel}
        </p>
        <h1 id="alert-title" className="t-h1 mt-2">
          {detail.maskedName} 님의 폭염 위험이 높습니다
        </h1>
        <p className="t-data-l mt-5" aria-label={`HRI ${detail.hri}점`}>
          HRI <span className="num">{detail.hri}</span>
        </p>
        <p className="t-caption text-fg-2 mt-1">{formatOccurredAt(detail.occurredAt)} 기준</p>
      </div>
    </section>

    <section className="mt-6 rounded-xl border border-border bg-raised p-5" aria-labelledby="why">
      <h2 id="why" className="t-h3">
        지금 위험한 이유
      </h2>
      {detail.reasons.length > 0 ? (
        <ol className="mt-4 space-y-3">
          {detail.reasons.map((reason, index) => (
            <li key={`${reason}:${index}`} className="t-body-s flex gap-3">
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-full font-bold text-white"
                style={{ background: "var(--heat-3)" }}
              >
                {index + 1}
              </span>
              <span>{reason}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="t-body-s text-fg-2 mt-3">상세 이유를 확인하는 중입니다.</p>
      )}
    </section>

    <section className="mt-6 rounded-xl border border-border bg-raised p-5" aria-labelledby="now">
      <h2 id="now" className="t-h3">
        지금 해 주세요
      </h2>
      <ul className="t-body-s mt-4 space-y-2">
        <li>• 시원한 실내나 그늘로 이동해 주세요.</li>
        <li>• 물을 조금씩 자주 마시게 해 주세요.</li>
        <li>• 의식 저하·경련·심한 어지럼이 있으면 즉시 119에 연락하세요.</li>
      </ul>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <a
          href="/shelters?scope=alert"
          className="t-body-s inline-flex min-h-12 items-center justify-center rounded-lg px-4 font-bold text-white"
          style={{ background: "var(--brand)" }}
        >
          가까운 쉼터 찾기
        </a>
        <a
          href="tel:119"
          className="t-body-s inline-flex min-h-12 items-center justify-center rounded-lg border-2 px-4 font-bold"
          style={{ borderColor: "var(--heat-4)", color: "var(--heat-4)" }}
        >
          응급 증상 — 119에 전화
        </a>
      </div>
    </section>
  </main>
);
