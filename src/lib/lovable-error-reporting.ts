import { toPublicErrorDto } from "./error-dto";

type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableErrorContext = {
  boundary?: "tanstack_root_error_component";
};

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
    __lovableReportRuntimeError?: (payload: {
      message: string;
      stack?: string;
      filename?: string;
    }) => void;
  }
}

export function reportLovableError(error: unknown, context: LovableErrorContext = {}) {
  if (typeof window === "undefined") return;
  const publicError = toPublicErrorDto(error);
  const safeContext = {
    source: "react_error_boundary",
    ...(context.boundary === "tanstack_root_error_component" ? { boundary: context.boundary } : {}),
    errorCode: publicError.code,
    retryable: publicError.retryable,
  };

  window.__lovableEvents?.captureException?.(publicError, safeContext, {
    mechanism: "react_error_boundary",
    handled: false,
    severity: "error",
  });
  // The preview hook is still a client transmission boundary. Only send the
  // stable public code; never forward raw messages, stacks, URLs, or responses.
  window.__lovableReportRuntimeError?.({
    message: publicError.code,
    filename: "client",
  });
}
