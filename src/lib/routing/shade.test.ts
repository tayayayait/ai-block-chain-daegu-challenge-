import { describe, expect, it } from "vitest";

import { daeguRoute } from "./fixtures/routes";
import {
  boundedShadowLengthMeters,
  createBuildingShadow,
  filterShadowsIntersectingRoute,
  splitRouteByShade,
  type PolygonGeometry,
} from "./shade";

const building = {
  type: "Polygon" as const,
  coordinates: [
    [
      [128.6009, 35.86995],
      [128.6011, 35.86995],
      [128.6011, 35.87005],
      [128.6009, 35.87005],
      [128.6009, 35.86995],
    ],
  ],
} satisfies PolygonGeometry;

describe("building shadow geometry", () => {
  it("projects a polygon in the direction opposite the sun for horizontal and vertical edges", () => {
    const shadow = createBuildingShadow(building, 10, {
      kind: "DAYLIGHT",
      altitudeRad: Math.PI / 4,
      azimuthRad: Math.PI,
    });
    const parts = shadow.type === "Polygon" ? [shadow.coordinates] : shadow.coordinates;
    const latitudes = parts.flatMap((part) =>
      part.flatMap((ring) => ring.map((position) => position[1])),
    );

    expect(Math.max(...latitudes)).toBeGreaterThan(35.87005);
  });

  it("caps near-horizon projections and reports that the displayed extent is partial", () => {
    expect(boundedShadowLengthMeters(30, Math.PI / 180, 300)).toEqual({
      distanceM: 300,
      capped: true,
    });
    expect(boundedShadowLengthMeters(10, Math.PI / 4, 300)).toMatchObject({
      distanceM: expect.closeTo(10),
      capped: false,
    });
  });

  it("splits shade and sunlight with a one percent conservation contract", () => {
    const shadow = {
      type: "Polygon" as const,
      coordinates: [
        [
          [128.6009, 35.8699],
          [128.6011, 35.8699],
          [128.6011, 35.8701],
          [128.6009, 35.8701],
          [128.6009, 35.8699],
        ],
      ],
    } satisfies PolygonGeometry;

    const result = splitRouteByShade(daeguRoute, [shadow]);
    const difference = Math.abs(
      result.totalDistanceM - (result.shadeDistanceM + result.sunDistanceM),
    );

    expect(result.shadeDistanceM).toBeGreaterThan(0);
    expect(result.sunDistanceM).toBeGreaterThan(0);
    expect(difference / result.totalDistanceM).toBeLessThanOrEqual(0.01);
    expect(result.shadeRatio).toBeGreaterThan(0);
    expect(result.shadeRatio).toBeLessThan(1);
  });

  it("filters shadows to only those that intersect the route", () => {
    // daeguRoute is near [128.6, 35.87]
    const intersectingShadow = {
      type: "Polygon" as const,
      coordinates: [
        [
          [128.6009, 35.8699],
          [128.6011, 35.8699],
          [128.6011, 35.8701],
          [128.6009, 35.8701],
          [128.6009, 35.8699],
        ],
      ],
    } satisfies PolygonGeometry;

    const farAwayShadow = {
      type: "Polygon" as const,
      coordinates: [
        [
          [128.65, 35.9],
          [128.66, 35.9],
          [128.66, 35.91],
          [128.65, 35.91],
          [128.65, 35.9],
        ],
      ],
    } satisfies PolygonGeometry;

    const filtered = filterShadowsIntersectingRoute(daeguRoute, [
      intersectingShadow,
      farAwayShadow,
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toEqual(intersectingShadow);
  });
});
