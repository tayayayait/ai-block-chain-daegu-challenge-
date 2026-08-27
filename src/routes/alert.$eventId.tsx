import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Clock3, ShieldAlert } from "lucide-react";
import { z } from "zod";

import { PaperShell } from "@/components/onjung/Shells";
import { AlertDetailView } from "@/lib/alerts/AlertDetailView";
import type { GuardianAlertDetailResult } from "@/lib/alerts/service.server";

const AlertEventRequestSchema = z.object({ eventId: z.string().uuid() }).strict();
const AlertTokenRequestSchema = AlertEventRequestSchema.extend({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}).strict();
const AlertSearchSchema = z.object({ token: z.string().max(512).optional() }).strict();
type AlertSearch = z.infer<typeof AlertSearchSchema> | Readonly<{ invalid: true }>;

const exchangeAlertToken = createServerFn({ method: "POST" })
  .validator((input: unknown) => AlertTokenRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const { exchangeGuardianAlertTokenForRequest } = await import("@/lib/alerts/request.server");
    return exchangeGuardianAlertTokenForRequest(data);
  });

const loadAlertDetail = createServerFn({ method: "GET" })
  .validator((input: unknown) => AlertEventRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const { loadGuardianAlertForRequest } = await import("@/lib/alerts/request.server");
    return loadGuardianAlertForRequest(data);
  });

const unavailable = (): GuardianAlertDetailResult => ({ kind: "UNAVAILABLE" });

export const Route = createFileRoute("/alert/$eventId")({
  validateSearch: (rawSearch): AlertSearch => {
    const parsed = AlertSearchSchema.safeParse(rawSearch);
    return parsed.success ? parsed.data : { invalid: true };
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }): Promise<GuardianAlertDetailResult> => {
    const event = AlertEventRequestSchema.safeParse({ eventId: params.eventId });
    if (!event.success || "invalid" in deps) return unavailable();

    if (deps.token !== undefined) {
      const token = AlertTokenRequestSchema.safeParse({
        eventId: event.data.eventId,
        token: deps.token,
      });
      if (!token.success) return unavailable();

      let exchange: Awaited<ReturnType<typeof exchangeAlertToken>>;
      try {
        exchange = await exchangeAlertToken({ data: token.data });
      } catch {
        return unavailable();
      }
      if (exchange.kind !== "REDIRECT") return unavailable();
      throw redirect({
        href: `/alert/${encodeURIComponent(event.data.eventId)}`,
        replace: true,
      });
    }

    try {
      return await loadAlertDetail({ data: event.data });
    } catch {
      return unavailable();
    }
  },
  head: () => ({
    meta: [
      { title: "폭염 위험 알림 — 온중 溫證" },
      {
        name: "description",
        content: "보호 대상자의 폭염 위험과 지금 필요한 행동을 안전하게 확인합니다.",
      },
      { name: "robots", content: "noindex,nofollow,noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: GuardianAlertRoute,
});

function GuardianAlertRoute() {
  const result = Route.useLoaderData();

  return (
    <PaperShell back="/" backLabel="홈" defaultSeniorMode>
      {result.kind === "READY" ? <AlertDetailView detail={result.detail} /> : <UnavailableView />}
    </PaperShell>
  );
}

function UnavailableView() {
  return (
    <main className="mx-auto max-w-xl py-12">
      <section
        className="border-border bg-raised rounded-xl border p-6 sm:p-8"
        aria-labelledby="unavailable-title"
      >
        <div
          className="grid size-12 place-items-center rounded-full"
          style={{ background: "var(--overlay)", color: "var(--fg-2)" }}
        >
          <Clock3 className="size-6" aria-hidden="true" />
        </div>
        <h1 id="unavailable-title" className="t-h2 mt-5">
          알림 링크를 열 수 없습니다
        </h1>
        <p className="t-body-s text-fg-2 mt-3">
          만료되었거나 이미 다른 기기에서 사용된 링크입니다. 개인정보 보호를 위해 상세 내용은
          표시하지 않습니다.
        </p>
        <div className="border-border mt-6 rounded-lg border p-4">
          <div className="flex gap-3">
            <ShieldAlert className="text-warning mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p className="t-body-s">
              새 알림 링크가 필요하면 담당 돌봄기관에 문의해 주세요. 응급 증상이 있다면 링크와
              관계없이 119에 연락하세요.
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <a href="/" className="btn-primary inline-flex min-h-12 items-center justify-center px-5">
            홈으로 이동
          </a>
          <a
            href="tel:119"
            className="t-body-s inline-flex min-h-12 items-center justify-center rounded-lg border-2 px-5 font-bold"
            style={{ borderColor: "var(--heat-4)", color: "var(--heat-4)" }}
          >
            응급 증상 — 119
          </a>
        </div>
      </section>
    </main>
  );
}
