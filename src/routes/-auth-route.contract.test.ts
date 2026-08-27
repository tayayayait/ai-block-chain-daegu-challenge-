import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const dashboard = read("src/routes/dashboard.tsx");
const subject = read("src/routes/subjects.$id.tsx");
const login = read("src/routes/login.tsx");

describe("protected route contracts", () => {
  it("guards dashboard before its loader runs", () => {
    expect(dashboard).toMatch(/beforeLoad\s*:\s*async/);
    expect(dashboard).toContain("requireStaffRouteAccess");
    expect(dashboard.indexOf("beforeLoad:")).toBeLessThan(dashboard.indexOf("loader:"));
  });

  it("guards subject detail with the route subject id before its loader runs", () => {
    expect(subject).toMatch(/beforeLoad\s*:\s*async/);
    expect(subject).toContain("requireSubjectRouteAccess");
    expect(subject).toContain("subjectId: params.id");
    expect(subject.indexOf("beforeLoad:")).toBeLessThan(subject.indexOf("loader:"));
  });

  it("provides a public login route using only the browser Supabase adapter", () => {
    expect(login).toContain('createFileRoute("/login")');
    expect(login).toContain("signInStaffWithPassword");
    expect(login).toContain("createBrowserSupabaseClient");
    expect(login).not.toMatch(/service_role|SUPABASE_SECRET_KEY|createAdminSupabaseClient/);
  });
});
