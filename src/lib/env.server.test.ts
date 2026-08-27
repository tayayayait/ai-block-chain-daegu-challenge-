import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./env.server";

const validEnvironment = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  // secret-scan: allow-next-line -- test-fixture
  SUPABASE_SECRET_KEY: "secret-key",
  DATA_GO_SERVICE_KEY: "data-go-key",
  // secret-scan: allow-next-line -- test-fixture
  KMA_APIHUB_AUTH_KEY: "kma-hub-key",
  // secret-scan: allow-next-line -- test-fixture
  GEMINI_API_KEY: "gemini-key",
  GEMINI_MODEL: "gemini-3.5-flash",
  NAVER_MAPS_CLIENT_ID: "naver-client-id",
  // secret-scan: allow-next-line -- test-fixture
  NAVER_MAPS_CLIENT_SECRET: "naver-client-secret",
  // secret-scan: allow-next-line -- test-fixture
  TMAP_APP_KEY: "tmap-app-key",
};

describe("parseServerEnv", () => {
  it("서버 통합에 필요한 환경 변수를 파싱한다", () => {
    expect(parseServerEnv(validEnvironment)).toMatchObject(validEnvironment);
  });

  it("Gemini 모델을 gemini-3.5-flash로 기본 설정한다", () => {
    const { GEMINI_MODEL: _model, ...withoutModel } = validEnvironment;

    expect(parseServerEnv(withoutModel).GEMINI_MODEL).toBe("gemini-3.5-flash");
  });

  it("실제 발송 공급자가 없으면 알림 작업을 disabled로 기본 설정한다", () => {
    expect(parseServerEnv(validEnvironment)).toMatchObject({
      NOTIFICATION_PROVIDER: "disabled",
      NOTIFICATION_LIVE_SEND_ENABLED: false,
    });
  });

  it("Phase 0에서는 알림 live 발송 활성화를 거부한다", () => {
    expect(() =>
      parseServerEnv({
        ...validEnvironment,
        NOTIFICATION_PROVIDER: "disabled",
        NOTIFICATION_LIVE_SEND_ENABLED: "true",
      }),
    ).toThrow(/NOTIFICATION_LIVE_SEND_ENABLED/);
  });

  it("Supabase REST 경로가 아니라 프로젝트 루트 URL만 허용한다", () => {
    expect(() =>
      parseServerEnv({
        ...validEnvironment,
        SUPABASE_URL: "https://example.supabase.co/rest/v1/",
      }),
    ).toThrow(/SUPABASE_URL/);
  });

  it("검증 오류에 다른 비밀값을 포함하지 않는다", () => {
    const sentinelSecret = "must-never-appear-in-an-error";

    expect(() =>
      parseServerEnv({
        ...validEnvironment,
        SUPABASE_SECRET_KEY: sentinelSecret,
        TMAP_APP_KEY: "",
      }),
    ).toThrowError(expect.not.stringContaining(sentinelSecret));
  });
});
