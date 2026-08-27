import { createFileRoute } from "@tanstack/react-router";

import { PaperShell } from "@/components/onjung/Shells";
import { StaffLoginForm } from "@/lib/auth/route-access-login";
import { signInStaffWithPassword } from "@/lib/auth/route-access.browser";
import { loginSearchSchema } from "@/lib/auth/route-access";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  head: () => ({
    meta: [
      { title: "담당자 로그인 — 온중 溫證" },
      {
        name: "description",
        content: "온중 관제 대시보드와 담당 대상자 정보를 위한 담당자 로그인 화면입니다.",
      },
    ],
  }),
  component: StaffLoginRoute,
});

function StaffLoginRoute() {
  const { next } = Route.useSearch();

  return (
    <PaperShell showSeniorToggle={false}>
      <main className="mx-auto max-w-md pt-8 sm:pt-16">
        <div className="border-border bg-raised rounded-xl border p-6 shadow-sh-1 sm:p-8">
          <p className="t-caption font-semibold" style={{ color: "var(--brand)" }}>
            온중 溫證
          </p>
          <h1 className="t-h1 mt-2">담당자 로그인</h1>
          <StaffLoginForm
            nextPath={next}
            authenticate={(credentials) =>
              signInStaffWithPassword(credentials, createBrowserSupabaseClient())
            }
            onSuccess={(nextPath) => window.location.assign(nextPath)}
          />
        </div>
      </main>
    </PaperShell>
  );
}
