import { describe, expect, it } from "vitest";

import { dashboardSearchSchema } from "./search";

describe("dashboardSearchSchema", () => {
  it("applies stable defaults when a dashboard URL has no search parameters", () => {
    expect(dashboardSearchSchema.parse({})).toEqual({
      gu: "전체",
      level: "L3",
      sort: "hri",
      order: "desc",
    });
  });

  it("restores a valid shared filter and sort URL", () => {
    expect(
      dashboardSearchSchema.parse({
        gu: "수성구",
        level: "L4",
        sort: "age",
        order: "asc",
      }),
    ).toEqual({ gu: "수성구", level: "L4", sort: "age", order: "asc" });
  });

  it("fails closed to canonical values for malformed search parameters", () => {
    expect(
      dashboardSearchSchema.parse({
        gu: "<script>",
        level: "HIGH",
        sort: "phone",
        order: "sideways",
      }),
    ).toEqual({ gu: "전체", level: "L3", sort: "hri", order: "desc" });
  });
});
