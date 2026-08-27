import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { protectedLocationPath, requireSubjectRouteAccess } from "@/lib/auth/route-access";
import { SubjectDetailView } from "@/lib/subject-detail/SubjectDetailView";

const subjectRequestSchema = z
  .object({
    subjectId: z.string().uuid(),
  })
  .strict();

const subjectRevealSchema = subjectRequestSchema.extend({
  purpose: z.literal("CARE_COORDINATION"),
});

const getSubjectDetail = createServerFn({ method: "GET" })
  .validator((input: unknown) => subjectRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const { loadSubjectDetailForRequest } = await import("@/lib/subject-detail/request.server");
    return loadSubjectDetailForRequest(data);
  });

const revealSubjectPii = createServerFn({ method: "POST" })
  .validator((input: unknown) => subjectRevealSchema.parse(input))
  .handler(async ({ data }) => {
    const { revealSubjectPiiForRequest } = await import("@/lib/subject-detail/request.server");
    return revealSubjectPiiForRequest(data);
  });

export const Route = createFileRoute("/subjects/$id")({
  head: () => ({
    meta: [
      { title: "대상자 상세 — 온중 溫證" },
      {
        name: "description",
        content: "권한 범위 안에서 개인별 폭염 위험도 구성과 돌봄 이력을 확인합니다.",
      },
    ],
  }),
  beforeLoad: async ({ location, params }) => {
    await requireSubjectRouteAccess({
      subjectId: params.id,
      nextPath: protectedLocationPath(location),
    });
  },
  loader: async ({ params }) => {
    const result = await getSubjectDetail({ data: { subjectId: params.id } });
    if (result.kind === "redirect") {
      throw redirect({ href: result.href });
    }
    return result;
  },
  component: SubjectDetailRoute,
});

function SubjectDetailRoute() {
  const result = Route.useLoaderData();

  if (result.kind === "error") {
    return (
      <div className="shade bg-background text-foreground min-h-dvh px-4 py-12">
        <div
          className="border-border bg-raised mx-auto max-w-xl rounded-lg border p-6"
          role="alert"
        >
          <h1 className="t-h2">대상자 정보를 열 수 없습니다</h1>
          <p className="text-fg-2 t-body-s mt-3">{result.error.userMessage}</p>
          <a
            href="/dashboard"
            className="t-body-s mt-5 inline-flex min-h-[var(--tap-min)] items-center font-semibold underline"
            style={{ color: "var(--brand)" }}
          >
            명단으로 돌아가기
          </a>
        </div>
      </div>
    );
  }

  return (
    <SubjectDetailView
      detail={result.data}
      features={{
        medicationCapture: {
          ready: true,
          href: `/medication/${encodeURIComponent(result.data.subject.id)}`,
        },
        shelterRouting: {
          ready: true,
          href: `/shelters?subjectId=${encodeURIComponent(result.data.subject.id)}`,
        },
        guardianAlert: { ready: false },
        attestationVerification: { ready: true, href: "/verify" },
      }}
      requestFullPii={async () => {
        const reveal = await revealSubjectPii({
          data: { subjectId: result.data.subject.id, purpose: "CARE_COORDINATION" },
        });
        if (reveal.kind === "redirect" && typeof window !== "undefined") {
          window.location.assign(reveal.href);
        }
        return reveal;
      }}
    />
  );
}
