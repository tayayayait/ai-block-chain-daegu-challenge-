import { describe, expect, it } from "vitest";

import dashboardSource from "./dashboard.tsx?raw";
import dashboardViewSource from "../lib/dashboard/DashboardView.tsx?raw";

describe("dashboard interactive element contract", () => {
  it("링크형 버튼은 Btn asChild를 사용해 anchor와 button을 중첩하지 않는다", () => {
    const dashboardImplementation = `${dashboardSource}\n${dashboardViewSource}`;
    expect(dashboardImplementation).not.toMatch(/<Link\b[^>]*>\s*<Btn\b/);
    expect(dashboardImplementation).toContain("<Btn asChild");
  });
});
