import { describe, expect, it } from "vitest";

import hriSource from "./hri.ts?raw";

describe("HRI module boundary", () => {
  it("UI 등급 라벨·형태·조치 상수를 계산 모듈에서 export하지 않는다", () => {
    expect(hriSource).not.toMatch(/export const LEVEL_(?:LABEL|SHAPE|ACTION)/);
  });

  it("일반 해시 표시 함수를 계산 모듈에서 export하지 않는다", () => {
    expect(hriSource).not.toMatch(/export const shortHash/);
  });
});
