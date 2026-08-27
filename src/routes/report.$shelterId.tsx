import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { CheckCircle2, Landmark, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PaperShell } from "@/components/onjung/Shells";
import type { ShelterReportSubmissionResult } from "@/lib/reports/repository.server";
import { ShelterIdSchema, type ShelterReportTargetDto } from "@/lib/shelters/public-dto";

const loadReportTarget = createServerFn({ method: "GET" })
  .validator((input: unknown) => ShelterIdSchema.parse(input))
  .handler(async ({ data }) => {
    const [{ setResponseHeader }, { getShelterById }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/lib/shelters/lookup.server"),
    ]);
    setResponseHeader("cache-control", "public, max-age=300, stale-while-revalidate=3600");
    return getShelterById(data);
  });

type ReportTargetData =
  Readonly<{ kind: "READY"; shelter: ShelterReportTargetDto }> | Readonly<{ kind: "NOT_FOUND" }>;

export const Route = createFileRoute("/report/$shelterId")({
  loader: async ({ params }): Promise<ReportTargetData> => {
    try {
      return { kind: "READY", shelter: await loadReportTarget({ data: params.shelterId }) };
    } catch {
      return { kind: "NOT_FOUND" };
    }
  },
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { handleShelterReportPostRequest } = await import("./-report-post.server");
        return handleShelterReportPostRequest(request, undefined, params.shelterId);
      },
    },
  },
  head: () => ({
    meta: [
      { title: "쉼터 운영상태 제보 — 온중 溫證" },
      {
        name: "description",
        content: "무더위쉼터의 현재 운영 여부와 혼잡도를 익명으로 제보합니다.",
      },
    ],
  }),
  component: ShelterReportRoute,
});

const ReportFormSchema = z
  .object({
    isOpen: z.enum(["true", "false"]),
    crowd: z.enum(["", "SPARSE", "MODERATE", "CROWDED"]),
  })
  .strict();
type ReportFormValues = z.infer<typeof ReportFormSchema>;

const PublicSubmissionResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.enum(["ACCEPTED", "IDEMPOTENT"]),
    reportId: z.string().uuid(),
    attest: z.enum(["UNVERIFIED", "PENDING", "VERIFIED", "FAILED"]),
    jobState: z.enum(["PENDING", "PROCESSING", "RETRY_WAIT", "VERIFIED", "FAILED"]),
  }),
  z.object({
    outcome: z.enum(["DUPLICATE", "RATE_LIMITED"]),
    retryAfter: z.string().datetime({ offset: true }),
  }),
]);

function ShelterReportRoute() {
  const data = Route.useLoaderData();
  return (
    <PaperShell back="/shelters" backLabel="쉼터 목록" defaultSeniorMode>
      {data.kind === "READY" ? (
        <ReportForm shelter={data.shelter} />
      ) : (
        <main className="py-10">
          <h1 className="t-h2">쉼터를 찾을 수 없습니다</h1>
          <p className="t-body-s text-fg-2 mt-3">목록에서 다른 쉼터를 선택해 주세요.</p>
          <a href="/shelters" className="btn-primary mt-6 inline-flex min-h-12 items-center px-5">
            쉼터 목록으로 이동
          </a>
        </main>
      )}
    </PaperShell>
  );
}

function ReportForm({ shelter }: { shelter: ShelterReportTargetDto }) {
  const requestId = useRef(crypto.randomUUID());
  const [result, setResult] = useState<ShelterReportSubmissionResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ReportFormValues>({
    resolver: zodResolver(ReportFormSchema),
    defaultValues: { isOpen: "true", crowd: "" },
    mode: "onBlur",
  });

  if (result?.outcome === "ACCEPTED" || result?.outcome === "IDEMPOTENT") {
    return (
      <main className="py-8">
        <section className="border-success/40 bg-raised rounded-xl border p-6" role="status">
          <CheckCircle2 className="text-success size-10" aria-hidden="true" />
          <h1 className="t-h2 mt-4">운영상태 제보가 저장되었습니다</h1>
          <p className="t-body-s text-fg-2 mt-3">
            공개 운영상태 제보는 대상자 체크인이나 HRI 완화 점수에 영향을 주지 않습니다.
          </p>
          <div className="border-attest/40 mt-5 rounded-lg border p-4">
            <p className="t-label text-attest">
              {result.jobState === "FAILED"
                ? "오프체인 저장 완료 · 온체인 증명 제외"
                : "Base Sepolia 테스트넷 · 기록 대기"}
            </p>
            <p className="t-caption text-fg-2 mt-2">
              {result.jobState === "FAILED"
                ? "혼잡도를 확인하지 못한 제보는 사실을 임의로 채우지 않고 온체인 증명에서 제외합니다. 제보 자체는 유지됩니다."
                : "오프체인 저장은 완료되었고 온체인 작업은 별도로 처리됩니다. 실패해도 제보는 유지됩니다."}
            </p>
          </div>
          <a href="/shelters" className="btn-primary mt-6 inline-flex min-h-12 items-center px-5">
            쉼터 목록으로 돌아가기
          </a>
        </section>
      </main>
    );
  }

  const retryLabel =
    result?.outcome === "DUPLICATE" || result?.outcome === "RATE_LIMITED"
      ? new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(result.retryAfter))
      : null;

  return (
    <main className="pb-12">
      <header className="pt-3">
        <p className="t-caption font-bold text-brand">SHELTER STATUS</p>
        <h1 className="t-d1 mt-2">현재 상태 알려주기</h1>
        <p className="t-body-s text-fg-2 mt-3">
          직접 확인한 현재 상태만 제보해 주세요. 익명 식별자는 안전한 HttpOnly 쿠키로 관리합니다.
        </p>
      </header>

      <section className="border-border bg-raised mt-6 rounded-xl border p-5">
        <div className="flex items-start gap-3">
          <Landmark className="text-brand mt-1 size-6 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="t-h3">{shelter.name}</h2>
            <p className="t-body-s text-fg-2 mt-1">
              {shelter.facilityType} · {shelter.gu}
            </p>
            <p className="t-caption text-fg-2 mt-1">{shelter.roadAddress}</p>
          </div>
        </div>
      </section>

      <form
        className="border-border bg-raised mt-5 rounded-xl border p-5 sm:p-6"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          setServerError(null);
          const body = new FormData();
          body.set("shelterId", shelter.id);
          body.set("isOpen", values.isOpen);
          body.set("crowd", values.crowd);
          body.set("clientRequestId", requestId.current);
          try {
            const response = await fetch(window.location.pathname, {
              method: "POST",
              body,
              credentials: "same-origin",
              headers: { Accept: "application/json" },
            });
            const payload: unknown = await response.json();
            if (
              typeof payload !== "object" ||
              payload === null ||
              !("ok" in payload) ||
              (payload as { ok?: unknown }).ok !== true ||
              !("result" in payload)
            ) {
              throw new Error("invalid response");
            }
            const parsed = PublicSubmissionResultSchema.safeParse(
              (payload as { result: unknown }).result,
            );
            if (!parsed.success) throw new Error("invalid response");
            setResult(parsed.data);
          } catch {
            setServerError("제보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
          }
        })}
      >
        <fieldset>
          <legend className="t-h3">지금 문이 열려 있나요?</legend>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="border-border flex min-h-14 items-center gap-3 rounded-lg border px-4 font-bold">
              <input type="radio" value="true" {...form.register("isOpen")} /> 열려 있어요
            </label>
            <label className="border-border flex min-h-14 items-center gap-3 rounded-lg border px-4 font-bold">
              <input type="radio" value="false" {...form.register("isOpen")} /> 닫혀 있어요
            </label>
          </div>
        </fieldset>

        <label className="t-label mt-6 block" htmlFor="report-crowd">
          혼잡도 (선택)
        </label>
        <select
          id="report-crowd"
          className="field mt-2 min-h-12 w-full"
          {...form.register("crowd")}
        >
          <option value="">확인하지 못했어요</option>
          <option value="SPARSE">여유</option>
          <option value="MODERATE">보통</option>
          <option value="CROWDED">혼잡</option>
        </select>

        {retryLabel ? (
          <p className="t-body-s text-warning mt-4" role="alert">
            최근 제보가 있어 {retryLabel} 이후 다시 제보할 수 있습니다.
          </p>
        ) : null}
        {serverError ? (
          <p className="t-body-s text-danger mt-4" role="alert">
            {serverError}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn-primary mt-6 min-h-14 w-full px-6"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "저장 중…" : "이 상태로 제보하기"}
        </button>
      </form>

      <div className="border-attest/40 mt-5 rounded-xl border p-4" role="note">
        <div className="flex gap-3">
          <ShieldCheck className="text-attest mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="t-caption text-fg-2">
            이 기록은 Base Sepolia 테스트넷에 발급되며, 발급·폐기 이력을 공개 검증할 수 있습니다.
            운영 결제나 실물 자산 거래가 아닙니다.
          </p>
        </div>
      </div>
    </main>
  );
}
