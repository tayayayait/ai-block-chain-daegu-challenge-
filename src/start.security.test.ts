import { isNotFound, isRedirect, notFound, redirect } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as startModule from "./start";

const SECRET_PATTERN =
  /AUTH_KEY_SENTINEL|SERVICE_KEY_SENTINEL|BEARER_SENTINEL|eyJhbGciOiJIUzI1NiJ9|STACK_SENTINEL|CAUSE_SENTINEL|홍길동|010-1234-5678|900101-1234567|private\.example/;

type StartSecurityApi = {
  handleStartError?: (error: unknown) => Response;
};

const api = startModule as StartSecurityApi;

function captureThrown(action: () => unknown): unknown {
  try {
    action();
    return undefined;
  } catch (error) {
    return error;
  }
}

function secretPayloads(): unknown[] {
  const error = new Error("authKey=AUTH_KEY_SENTINEL 홍길동 010-1234-5678", {
    cause: new Error("CAUSE_SENTINEL Bearer BEARER_SENTINEL"),
  });
  error.stack = "STACK_SENTINEL serviceKey=SERVICE_KEY_SENTINEL";

  const response = new Response("900101-1234567", { status: 503 });
  Object.defineProperty(response, "url", {
    configurable: true,
    value: "https://private.example/?serviceKey=SERVICE_KEY_SENTINEL",
  });

  return [
    error,
    response,
    {
      statusCode: 404,
      authorization: "Bearer BEARER_SENTINEL",
      jwt: "eyJhbGciOiJIUzI1NiJ9.private.signature",
      patient: "홍길동 900101-1234567",
    },
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TanStack Start safe error boundary", () => {
  it("실제 redirect와 not-found 제어 흐름은 동일 객체로 다시 던진다", () => {
    expect(api.handleStartError).toBeTypeOf("function");
    if (!api.handleStartError) return;

    const redirectControl = redirect({ href: "/dashboard" });
    const notFoundControl = notFound();
    expect(isRedirect(redirectControl)).toBe(true);
    expect(isNotFound(notFoundControl)).toBe(true);

    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(captureThrown(() => api.handleStartError?.(redirectControl))).toBe(redirectControl);
    expect(captureThrown(() => api.handleStartError?.(notFoundControl))).toBe(notFoundControl);
    expect(log).not.toHaveBeenCalled();
  });

  it("그 밖의 원본 오류는 비밀 없는 정적 500 응답과 안정 로그로 치환한다", async () => {
    expect(api.handleStartError).toBeTypeOf("function");
    if (!api.handleStartError) return;

    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (const payload of secretPayloads()) {
      const response = api.handleStartError(payload);
      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).not.toMatch(SECRET_PATTERN);
    }

    expect(log).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(SECRET_PATTERN);
    for (const [entry] of log.mock.calls) {
      expect(entry).toEqual({
        event: "server_error",
        code: "INTERNAL_ERROR",
        service: "request-middleware",
        status: 500,
      });
    }
  });
});
