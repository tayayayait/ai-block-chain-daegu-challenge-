import { afterEach, describe, expect, it, vi } from "vitest";

import * as serverModule from "./server";

const SECRET_PATTERN =
  /AUTH_KEY_SENTINEL|SERVICE_KEY_SENTINEL|BEARER_SENTINEL|eyJhbGciOiJIUzI1NiJ9|STACK_SENTINEL|CAUSE_SENTINEL|홍길동|010-1234-5678|900101-1234567|private\.example/;

type ServerSecurityApi = {
  normalizeCatastrophicSsrResponse?: (response: Response) => Promise<Response>;
};

const api = serverModule as ServerSecurityApi;

function inspectLoggedValue(value: unknown): string {
  if (value instanceof Error) {
    return `${value.message}\n${value.stack ?? ""}\n${inspectLoggedValue(value.cause)}`;
  }
  if (value instanceof Response) {
    return `${value.status} ${value.url}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SSR catastrophic response normalization", () => {
  it("H3 오류 JSON의 원문 필드는 로그와 공개 응답 어디에도 전달하지 않는다", async () => {
    expect(api.normalizeCatastrophicSsrResponse).toBeTypeOf("function");
    if (!api.normalizeCatastrophicSsrResponse) return;

    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const upstream = new Response(
      JSON.stringify({
        unhandled: true,
        message: "HTTPError",
        providerBody: "Bearer BEARER_SENTINEL",
        url: "https://private.example/?authKey=AUTH_KEY_SENTINEL",
        patient: "홍길동 900101-1234567",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );

    const response = await api.normalizeCatastrophicSsrResponse(upstream);
    const publicBody = await response.text();
    const logged = log.mock.calls.flat().map(inspectLoggedValue).join("\n");

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(publicBody).not.toMatch(SECRET_PATTERN);
    expect(log).toHaveBeenCalledWith({
      event: "server_error",
      code: "INTERNAL_ERROR",
      service: "ssr",
      status: 500,
    });
    expect(logged).not.toMatch(SECRET_PATTERN);
  });
});
