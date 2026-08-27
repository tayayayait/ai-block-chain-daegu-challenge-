import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { ShadeShell } from "@/components/onjung/Shells";
import { SubjectRegistrationForm } from "@/lib/admin/subject-registration-form";
import { subjectRegistrationInputSchema } from "@/lib/admin/subject-registration.schema";
import { protectedLocationPath, requireStaffRouteAccess } from "@/lib/auth/route-access";

const loadSubjectRegistrationAccess = createServerFn({ method: "GET" }).handler(async () => {
  const { readSubjectRegistrationAccessForRequest } =
    await import("@/lib/admin/subject-registration.server");
  return readSubjectRegistrationAccessForRequest();
});

const submitSubjectRegistration = createServerFn({ method: "POST" })
  .validator((input: unknown) => subjectRegistrationInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { registerSubjectForRequest } = await import("@/lib/admin/subject-registration.server");
    return registerSubjectForRequest(data);
  });

export const Route = createFileRoute("/subjects/new")({
  beforeLoad: async ({ location }) => {
    await requireStaffRouteAccess(protectedLocationPath(location));
  },
  loader: () => loadSubjectRegistrationAccess(),
  head: () => ({
    meta: [
      { title: "대상자 등록 — 온중 溫證" },
      {
        name: "description",
        content: "관리자가 동의받은 실제 대상자를 등록하고 대구 주소를 확인합니다.",
      },
    ],
  }),
  component: SubjectRegistrationRoute,
});

function SubjectRegistrationRoute() {
  const access = Route.useLoaderData();

  return (
    <ShadeShell weather={null}>
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <p className="t-caption font-semibold" style={{ color: "var(--brand)" }}>
            관리자 전용
          </p>
          <h1 className="t-h1 mt-2">대상자 등록</h1>
          <p className="text-fg-2 t-body-s mt-2">
            실제 동의와 확인된 정보를 입력하면 서버가 대구 주소·기상 격자를 확정합니다.
          </p>
        </header>

        {access.kind === "allow" ? (
          <SubjectRegistrationForm submit={(input) => submitSubjectRegistration({ data: input })} />
        ) : (
          <section className="border-border bg-raised rounded-xl border p-6" role="alert">
            <h2 className="t-h2">등록 권한을 확인할 수 없습니다</h2>
            <p className="text-fg-2 t-body-s mt-3">{access.userMessage}</p>
            <a
              href="/dashboard"
              className="t-body-s mt-5 inline-flex min-h-[var(--tap-min)] items-center font-semibold underline"
              style={{ color: "var(--brand)" }}
            >
              대시보드로 돌아가기
            </a>
          </section>
        )}
      </div>
    </ShadeShell>
  );
}
