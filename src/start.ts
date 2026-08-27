import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { isNotFound, isRedirect } from "@tanstack/react-router";

import { reportSafeServerError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

export function handleStartError(error: unknown): Response {
  let isFrameworkControlFlow = false;
  try {
    isFrameworkControlFlow = isRedirect(error) || isNotFound(error);
  } catch {
    // Hostile objects and Proxy traps are application failures, not router control flow.
  }

  if (isFrameworkControlFlow) {
    throw error;
  }

  reportSafeServerError("request-middleware", 500);
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    return handleStartError(error);
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
