import { describe, expect, it } from "vitest";

import routeSource from "@/routes/dashboard.tsx?raw";
import runtimeSource from "./runtime.server.ts?raw";
import serverSource from "./server-functions.ts?raw";

describe("S-01 route data contract", () => {
  it("does not import the legacy shared mock module or simulate polling with timers", () => {
    expect(routeSource).not.toContain("@/lib/mock/data");
    expect(routeSource).not.toMatch(/setInterval|setTimeout/);
  });

  it("parses URL search with Zod and preloads the same query used by the component", () => {
    expect(routeSource).toContain("validateSearch: dashboardSearchSchema");
    expect(routeSource).toContain("loaderDeps:");
    expect(routeSource).toContain("ensureQueryData");
    expect(routeSource).toContain("dashboardQueryOptions");
  });

  it("lets the dashboard render its own safe error state when initial preload fails", () => {
    expect(routeSource).toContain("catch");
    expect(routeSource).toContain("return null");
    expect(routeSource).toContain("...(initialSnapshot ? { initialData: initialSnapshot } : {})");
  });

  it("uses TanStack Query and URL navigation for real refresh and shareable filters", () => {
    expect(routeSource).toContain("useQuery(");
    expect(routeSource).toContain("Route.useNavigate()");
    expect(routeSource).toContain("Route.useSearch()");
    expect(routeSource).toContain("useMutation(");
  });

  it("exposes validated GET and POST server functions without accepting a client actor id", () => {
    expect(serverSource).toContain('createServerFn({ method: "GET" })');
    expect(serverSource).toContain('createServerFn({ method: "POST" })');
    expect(serverSource).not.toMatch(/actorId\s*:\s*data\./);
    expect(serverSource).toContain('import("./runtime.server")');
    expect(serverSource).not.toContain('@tanstack/react-start/server"');
    expect(runtimeSource).toContain("resolveDashboardActorId");
    expect(runtimeSource).toContain('import "@tanstack/react-start/server-only"');
  });

  it("uses verified Supabase session identity and never selects the demo adapter in production", () => {
    expect(runtimeSource).toContain("createSessionSupabaseClient");
    expect(runtimeSource).toContain("createAdminSupabaseClient");
    expect(runtimeSource).toContain("createSupabaseDashboardRepository");
    expect(runtimeSource).toContain("getCookies()");
    expect(runtimeSource).toContain("auth.getUser()");
    expect(runtimeSource).toContain("UUID.safeParse");
    expect(runtimeSource).not.toContain("createDemoDashboardRepository");
    expect(runtimeSource).not.toContain("dashboard-demo-session");
  });
});
