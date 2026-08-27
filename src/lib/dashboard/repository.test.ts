import { describe, expect, it } from "vitest";

import { createDashboardService } from "./service";
import { createDemoDashboardRepository } from "./demo-repository";
import type { DashboardSearch } from "./search";

const defaultSearch: DashboardSearch = {
  gu: "전체",
  level: "L3",
  sort: "hri",
  order: "desc",
};

describe("dashboard repository boundary", () => {
  it("returns masked, filterable dashboard DTOs sorted by HRI", async () => {
    const service = createDashboardService(createDemoDashboardRepository());
    const snapshot = await service.read({ actorId: "operator-a", search: defaultSearch });

    expect(snapshot.urgentSubjects.length).toBeGreaterThan(0);
    expect(
      snapshot.urgentSubjects.every((item) => item.level === "L3" || item.level === "L4"),
    ).toBe(true);
    expect(snapshot.urgentSubjects.map((item) => item.hri)).toEqual(
      [...snapshot.urgentSubjects].map((item) => item.hri).sort((a, b) => b - a),
    );
    expect(JSON.stringify(snapshot)).not.toMatch(/010-|guardian|phone|address/i);
  });

  it("applies gu, minimum level, sort, and order in the repository", async () => {
    const service = createDashboardService(createDemoDashboardRepository());
    const snapshot = await service.read({
      actorId: "operator-a",
      search: { gu: "수성구", level: "L4", sort: "age", order: "asc" },
    });

    expect(
      snapshot.urgentSubjects.every((item) => item.gu === "수성구" && item.level === "L4"),
    ).toBe(true);
    expect(snapshot.urgentSubjects.map((item) => item.age)).toEqual(
      [...snapshot.urgentSubjects].map((item) => item.age).sort((a, b) => a - b),
    );
  });

  it("stores L4 acknowledgements per authenticated actor", async () => {
    const service = createDashboardService(createDemoDashboardRepository());
    const beforeA = await service.read({ actorId: "operator-a", search: defaultSearch });
    const transitionId = beforeA.unreadL4Alerts[0]?.transitionId;
    expect(transitionId).toBeTruthy();

    await service.acknowledge({ actorId: "operator-a", transitionId: transitionId! });

    const afterA = await service.read({ actorId: "operator-a", search: defaultSearch });
    const afterB = await service.read({ actorId: "operator-b", search: defaultSearch });
    expect(afterA.unreadL4Alerts.some((item) => item.transitionId === transitionId)).toBe(false);
    expect(afterB.unreadL4Alerts.some((item) => item.transitionId === transitionId)).toBe(true);
  });

  it("rejects an acknowledgement for an unknown transition", async () => {
    const service = createDashboardService(createDemoDashboardRepository());
    await expect(
      service.acknowledge({ actorId: "operator-a", transitionId: "unknown-transition" }),
    ).rejects.toThrow("INVALID_REQUEST");
  });
});
