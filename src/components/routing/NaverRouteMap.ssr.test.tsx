// @vitest-environment node

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NaverRouteMap } from "./NaverRouteMap";
import type { RouteCandidateUiDto } from "./route-ui-dto";

const selected: RouteCandidateUiDto = {
  id: "route-a",
  label: "후보 1",
  distanceM: 500,
  spatialAnalysisAvailable: true,
  shadeRatio: 0.7,
  shadows: [],
  segments: [
    {
      id: "shade",
      exposure: "SHADE",
      distanceM: 500,
      coordinates: [
        [128.6, 35.87],
        [128.603, 35.871],
      ],
    },
  ],
  restSpots: [],
  warnings: [],
};

describe("NaverRouteMap server rendering", () => {
  it("renders the textual route shell without reading browser globals", () => {
    expect(() =>
      renderToString(<NaverRouteMap selected={selected} alternatives={[]} />),
    ).not.toThrow();
  });
});
