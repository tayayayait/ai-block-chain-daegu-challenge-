export const validPedestrianResponse = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [128.6, 35.87] },
      properties: { index: 0, totalDistance: 901, totalTime: 700, pointType: "SP" },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [128.6, 35.87],
          [128.605, 35.871],
        ],
      },
      properties: { index: 1, distance: 450, time: 350 },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [128.605, 35.871],
          [128.61, 35.87],
        ],
      },
      properties: { index: 2, distance: 451, time: 350 },
    },
  ],
} as const;
