// @vitest-environment node

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NaverShelterMap, type ShelterMapPoint } from "./NaverShelterMap";

const point: ShelterMapPoint = {
  id: "DG-0010",
  name: "DGB대구은행 시청영업부",
  latitude: 35.8716,
  longitude: 128.6012,
  open: "UNKNOWN",
  isImBank: true,
};

describe("NaverShelterMap server rendering", () => {
  it("renders the list-first map shell without reading browser globals", () => {
    expect(() => renderToString(<NaverShelterMap points={[point]} />)).not.toThrow();
  });
});
