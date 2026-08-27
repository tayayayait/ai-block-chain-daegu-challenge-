import { describe, expect, it } from "vitest";

import { LEVEL_ACTION, LEVEL_LABEL, LEVEL_SHAPE } from "./presentation";

describe("risk presentation", () => {
  it("모든 위험 등급의 라벨·형태·조치를 제공한다", () => {
    expect(Object.keys(LEVEL_LABEL)).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(Object.keys(LEVEL_SHAPE)).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(Object.keys(LEVEL_ACTION)).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(LEVEL_LABEL.L4).toBe("위험");
    expect(LEVEL_SHAPE.L4).toBe("✕");
    expect(LEVEL_ACTION.L4).toContain("담당자 즉시 알림");
  });
});
