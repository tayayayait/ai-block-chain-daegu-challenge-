import { describe, expect, it } from "vitest";

import { isParkFacilitySafeForRouting } from "./park-facility-policy";

describe("park facility heat-relief policy", () => {
  it.each([
    ["BENCH", "양호", false],
    ["PAVILION", "보통", false],
    ["PARK_FACILITY", null, false],
  ] as const)("accepts usable %s evidence", (restType, condition, repairRequired) => {
    expect(isParkFacilitySafeForRouting({ restType, condition, repairRequired })).toBe(true);
  });

  it.each([
    [null, "양호", false],
    ["BENCH", "불량", false],
    ["BENCH", "사용불가", false],
    ["PAVILION", "양호", true],
  ] as const)("rejects unsafe or irrelevant evidence", (restType, condition, repairRequired) => {
    expect(isParkFacilitySafeForRouting({ restType, condition, repairRequired })).toBe(false);
  });
});
