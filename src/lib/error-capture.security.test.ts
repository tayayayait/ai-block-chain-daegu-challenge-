import { afterEach, describe, expect, it, vi } from "vitest";

import * as errorCaptureModule from "./error-capture";

const SECRET_PATTERN =
  /AUTH_KEY_SENTINEL|SERVICE_KEY_SENTINEL|BEARER_SENTINEL|eyJhbGciOiJIUzI1NiJ9|STACK_SENTINEL|CAUSE_SENTINEL|홍길동|010-1234-5678|900101-1234567|private\.example/;

type SafeLog = Readonly<{
  event: "server_error";
  code: "INTERNAL_ERROR";
  service: "framework" | "request-middleware" | "ssr";
  status: number;
}>;

type ErrorCaptureSecurityApi = {
  installSafeConsoleError?: (sink?: (entry: SafeLog) => void) => () => void;
  consumeLastCapturedError: () => unknown;
  describeError: (error: unknown) => string;
};

const api = errorCaptureModule as ErrorCaptureSecurityApi;

function secretPayloads(): unknown[] {
  const cause = new Error("CAUSE_SENTINEL Bearer BEARER_SENTINEL");
  const error = new Error(
    "GET https://private.example/weather?authKey=AUTH_KEY_SENTINEL 홍길동 010-1234-5678",
    { cause },
  );
  error.stack = "STACK_SENTINEL serviceKey=SERVICE_KEY_SENTINEL";

  const response = new Response("900101-1234567", { status: 503 });
  Object.defineProperty(response, "url", {
    configurable: true,
    value: "https://private.example/api?serviceKey=SERVICE_KEY_SENTINEL",
  });

  return [
    error,
    response,
    {
      authorization: "Bearer BEARER_SENTINEL",
      jwt: "eyJhbGciOiJIUzI1NiJ9.private.signature",
      patient: "홍길동 900101-1234567",
      url: "https://private.example/?authKey=AUTH_KEY_SENTINEL",
    },
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safe server error capture", () => {
  it("원본 Error를 설명할 때 message, stack, cause 대신 안정 코드만 반환한다", () => {
    const [error] = secretPayloads();

    const description = api.describeError(error);

    expect(description).toBe("INTERNAL_ERROR");
    expect(description).not.toMatch(SECRET_PATTERN);
  });

  it("Error, Response, 비-Error 객체를 동일한 허용 필드 로그로 축약한다", () => {
    expect(api.installSafeConsoleError).toBeTypeOf("function");
    if (!api.installSafeConsoleError) return;

    const sink = vi.fn<(entry: SafeLog) => void>();
    const previousConsoleError = console.error;
    const restore = api.installSafeConsoleError(sink);

    try {
      for (const payload of secretPayloads()) {
        console.error(payload);
      }

      expect(sink).toHaveBeenCalledTimes(3);
      for (const [entry] of sink.mock.calls) {
        expect(entry).toEqual({
          event: "server_error",
          code: "INTERNAL_ERROR",
          service: "framework",
          status: 500,
        });
        expect(Object.keys(entry).sort()).toEqual(["code", "event", "service", "status"]);
      }
      expect(JSON.stringify(sink.mock.calls)).not.toMatch(SECRET_PATTERN);
      expect(api.consumeLastCapturedError()).toEqual({
        event: "server_error",
        code: "INTERNAL_ERROR",
        service: "framework",
        status: 500,
      });
    } finally {
      restore();
    }

    expect(console.error).toBe(previousConsoleError);
  });
});
