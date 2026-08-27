import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  browser: vi.fn(() => ({ role: "browser" })),
  session: vi.fn(() => ({ role: "session" })),
  admin: vi.fn(() => ({ role: "admin" })),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.browser,
  createServerClient: mocks.session,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.admin,
}));

import { createAdminSupabaseClient } from "./admin.server";
import { createBrowserSupabaseClient } from "./browser";
import { createSessionSupabaseClient } from "./session.server";

const environment = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  // secret-scan: allow-next-line -- test-fixture
  SUPABASE_SECRET_KEY: "server-secret-key",
};

describe("Supabase 역할별 클라이언트", () => {
  it("브라우저에는 publishable 값만 전달한다", () => {
    expect(
      createBrowserSupabaseClient({
        url: environment.SUPABASE_URL,
        publishableKey: environment.SUPABASE_PUBLISHABLE_KEY,
      }),
    ).toEqual({ role: "browser" });

    expect(mocks.browser).toHaveBeenCalledWith(
      environment.SUPABASE_URL,
      environment.SUPABASE_PUBLISHABLE_KEY,
    );
    expect(JSON.stringify(mocks.browser.mock.calls)).not.toContain(environment.SUPABASE_SECRET_KEY);
  });

  it("서버 세션 클라이언트는 요청별 cookie getAll/setAll을 그대로 연결한다", () => {
    const getAll = vi.fn(() => [{ name: "sb-session", value: "token" }]);
    const setAll = vi.fn();

    expect(createSessionSupabaseClient({ getAll, setAll }, environment)).toEqual({
      role: "session",
    });
    expect(mocks.session).toHaveBeenCalledWith(
      environment.SUPABASE_URL,
      environment.SUPABASE_PUBLISHABLE_KEY,
      { cookies: { getAll, setAll } },
    );
  });

  it("admin은 서버 secret만 사용하고 세션 지속·URL 감지를 비활성화한다", () => {
    expect(createAdminSupabaseClient(environment)).toEqual({ role: "admin" });
    expect(mocks.admin).toHaveBeenCalledWith(
      environment.SUPABASE_URL,
      environment.SUPABASE_SECRET_KEY,
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
  });
});
