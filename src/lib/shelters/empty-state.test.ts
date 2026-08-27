import { describe, expect, it } from "vitest";

import { getShelterEmptyAction } from "./empty-state";
import type { ShelterSearchQuery } from "./search-schema";

const query = {
  lat: 35.871,
  lng: 128.601,
  radius: 500,
  imBank: false,
  open: "ALL",
  sort: "priority",
  limit: 50,
} as const satisfies ShelterSearchQuery;

describe("shelter empty result action", () => {
  it("expands an unfiltered 500m search to 1km", () => {
    expect(getShelterEmptyAction(query, 0)).toEqual({ type: "EXPAND_RADIUS", radius: 1000 });
  });

  it("expands an unfiltered 1km search to 3km", () => {
    expect(getShelterEmptyAction({ ...query, radius: 1000 }, 0)).toEqual({
      type: "EXPAND_RADIUS",
      radius: 3000,
    });
  });

  it("asks to reset filters before expanding the geographic boundary", () => {
    expect(getShelterEmptyAction({ ...query, gu: "중구", imBank: true }, 0)).toEqual({
      type: "RESET_FILTERS",
    });
  });

  it("does not show an empty action when a result exists", () => {
    expect(getShelterEmptyAction(query, 1)).toEqual({ type: "NONE" });
  });

  it("stops expanding at the 3km contract maximum", () => {
    expect(getShelterEmptyAction({ ...query, radius: 3000 }, 0)).toEqual({
      type: "NO_RESULTS",
    });
  });
});
