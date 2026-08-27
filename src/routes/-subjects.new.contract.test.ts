import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(resolve(process.cwd(), "src/routes/subjects.new.tsx"), "utf8");
const server = readFileSync(
  resolve(process.cwd(), "src/lib/admin/subject-registration.server.ts"),
  "utf8",
);
const dashboard = readFileSync(resolve(process.cwd(), "src/routes/dashboard.tsx"), "utf8");

describe("ADMIN subject registration route contract", () => {
  it("protects the page and rechecks the POST on the server", () => {
    expect(route).toContain('createFileRoute("/subjects/new")');
    expect(route).toContain("requireStaffRouteAccess");
    expect(route).toContain('createServerFn({ method: "POST" })');
    expect(route).toContain("registerSubjectForRequest");
    expect(server).toContain("resolveVerifiedAdminActor");
    expect(server).toMatch(/private,\s*no-cache,\s*no-store/iu);
  });

  it("links registration from the dashboard without embedding subject fixtures", () => {
    expect(dashboard).toContain('href="/subjects/new"');
    expect(dashboard).toContain("대상자 등록");
  });
});
