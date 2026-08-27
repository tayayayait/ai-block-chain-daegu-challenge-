import { afterEach, describe, expect, it, vi } from "vitest";

import { createPublicError } from "./error-dto";
import { reportLovableError } from "./lovable-error-reporting";

afterEach(() => {
  delete window.__lovableEvents;
  delete window.__lovableReportRuntimeError;
});

describe("reportLovableError safe client telemetry", () => {
  it("원본 message, stack, URL 대신 공개 DTO와 허용된 문맥만 전달한다", () => {
    const captureException = vi.fn();
    const reportRuntimeError = vi.fn();
    window.__lovableEvents = { captureException };
    window.__lovableReportRuntimeError = reportRuntimeError;
    const upstream = new Error(
      "GET https://example.test/weather?authKey=AUTH_SECRET providerBody=PROVIDER_SECRET",
    );
    upstream.stack = "STACK_SECRET";

    reportLovableError(upstream, {
      boundary: "tanstack_root_error_component",
      providerBody: "CONTEXT_PROVIDER_SECRET",
      url: "https://example.test/private?serviceKey=CONTEXT_KEY",
    } as never);

    expect(captureException).toHaveBeenCalledWith(
      createPublicError("INTERNAL_ERROR"),
      {
        source: "react_error_boundary",
        boundary: "tanstack_root_error_component",
        errorCode: "INTERNAL_ERROR",
        retryable: true,
      },
      {
        mechanism: "react_error_boundary",
        handled: false,
        severity: "error",
      },
    );
    expect(reportRuntimeError).toHaveBeenCalledWith({
      message: "INTERNAL_ERROR",
      filename: "client",
    });

    const transmitted = JSON.stringify([
      captureException.mock.calls,
      reportRuntimeError.mock.calls,
    ]);
    expect(transmitted).not.toMatch(
      /AUTH_SECRET|PROVIDER_SECRET|STACK_SECRET|CONTEXT_PROVIDER_SECRET|CONTEXT_KEY|example\.test|serviceKey/,
    );
    expect(captureException.mock.calls[0]?.[1]).not.toHaveProperty("route");
  });

  it("Response 객체, URL, body를 원본 그대로 전달하지 않는다", () => {
    const captureException = vi.fn();
    const reportRuntimeError = vi.fn();
    window.__lovableEvents = { captureException };
    window.__lovableReportRuntimeError = reportRuntimeError;
    const response = new Response("RAW_RESPONSE_BODY", { status: 503 });
    Object.defineProperty(response, "url", {
      configurable: true,
      value: "https://example.test/api?serviceKey=RAW_QUERY_KEY",
    });

    reportLovableError(response);

    expect(captureException.mock.calls[0]?.[0]).not.toBe(response);
    expect(captureException.mock.calls[0]?.[0]).toEqual(createPublicError("INTERNAL_ERROR"));
    expect(
      JSON.stringify([captureException.mock.calls, reportRuntimeError.mock.calls]),
    ).not.toMatch(/RAW_RESPONSE_BODY|RAW_QUERY_KEY|example\.test|serviceKey/);
  });
});
