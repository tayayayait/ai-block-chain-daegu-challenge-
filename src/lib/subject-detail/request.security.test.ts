import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const requestSource = readFileSync(
  resolve(process.cwd(), "src/lib/subject-detail/request.server.ts"),
  "utf8",
);
const routeSource = readFileSync(resolve(process.cwd(), "src/routes/subjects.$id.tsx"), "utf8");

describe("subject detail server boundary", () => {
  it("keeps admin and request-cookie APIs behind a dynamic server-only boundary", () => {
    expect(requestSource).toContain('import "@tanstack/react-start/server-only"');
    expect(requestSource).toContain("createAdminSupabaseClient");
    expect(routeSource).toContain('await import("@/lib/subject-detail/request.server")');
    expect(routeSource).not.toContain("createAdminSupabaseClient");
    expect(routeSource).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("marks every subject response private and no-store", () => {
    expect(requestSource).toContain("private, no-cache, no-store, must-revalidate, max-age=0");
    expect(requestSource).toContain('setResponseHeader("expires", "0")');
    expect(requestSource).toContain('setResponseHeader("pragma", "no-cache")');
  });

  it("never logs private rows or provider errors", () => {
    expect(requestSource).not.toMatch(/console\.(?:log|debug|info|warn|error)/);
  });
});
