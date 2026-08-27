import { describe, expect, it, vi } from "vitest";

import { validPedestrianResponse } from "./fixtures/pedestrian-response";
import {
  createTmapPedestrianClient,
  TMAP_PEDESTRIAN_SEARCH_OPTIONS,
  TmapRoutingError,
} from "./tmap.server";

describe("TMAP pedestrian server adapter", () => {
  it("exposes only the options documented by the pedestrian endpoint", () => {
    expect(TMAP_PEDESTRIAN_SEARCH_OPTIONS).toEqual(["0", "4", "10", "30"]);
  });

  it("calls the server endpoint and normalizes line features and elder time", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validPedestrianResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createTmapPedestrianClient({
      appKey: "server-secret-app-key",
      fetchImpl,
      timeoutMs: 1_000,
    });
    const route = await client.route({
      start: [128.6, 35.87],
      destination: [128.61, 35.87],
      searchOption: "30",
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1");
    expect(new Headers(init.headers).get("appKey")).toBe("server-secret-app-key");
    expect(init.method).toBe("POST");
    expect(route).toMatchObject({
      searchOption: "30",
      distanceM: 901,
      providerDurationSec: 700,
      elderDurationSec: 1_202,
    });
    expect(route.coordinates).toEqual([
      [128.6, 35.87],
      [128.605, 35.871],
      [128.61, 35.87],
    ]);
  });

  it("rejects malformed GeoJSON with a safe error that contains neither key nor raw coordinates", async () => {
    const client = createTmapPedestrianClient({
      appKey: "do-not-leak-this",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ type: "FeatureCollection", features: [] })),
        ),
      timeoutMs: 1_000,
    });

    const error = await client
      .route({
        start: [128.600123, 35.870123],
        destination: [128.610123, 35.880123],
        searchOption: "30",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TmapRoutingError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
    expect(String(error)).not.toContain("do-not-leak-this");
    expect(String(error)).not.toContain("128.600123");
  });

  it("aborts a slow request and returns a stable timeout code", async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const client = createTmapPedestrianClient({ appKey: "secret", fetchImpl, timeoutMs: 5 });

    await expect(
      client.route({ start: [128.6, 35.87], destination: [128.61, 35.87], searchOption: "30" }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects disconnected line features instead of inventing a straight segment", async () => {
    const disconnected = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [128.6, 35.87],
              [128.601, 35.87],
            ],
          },
          properties: { index: 1, distance: 100, time: 100 },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [128.61, 35.88],
              [128.611, 35.88],
            ],
          },
          properties: { index: 2, distance: 100, time: 100 },
        },
      ],
    };
    const client = createTmapPedestrianClient({
      appKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue(Response.json(disconnected)),
    });

    await expect(
      client.route({ start: [128.6, 35.87], destination: [128.611, 35.88], searchOption: "30" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects negative provider duration values", async () => {
    const invalid = structuredClone(validPedestrianResponse) as unknown as {
      features: Array<{ properties: { totalTime?: number } }>;
    };
    invalid.features[0]!.properties.totalTime = -1;
    const client = createTmapPedestrianClient({
      appKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue(Response.json(invalid)),
    });

    await expect(
      client.route({ start: [128.6, 35.87], destination: [128.61, 35.87], searchOption: "30" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("clips route coordinates to requested start and destination endpoints", async () => {
    // Response extends south of start and north of destination
    const overshootingResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [128.6, 35.868], // 200m south of start (should be clipped)
              [128.6, 35.87], // requested start
              [128.6, 35.875], // intermediate
              [128.6, 35.88], // requested destination
              [128.6, 35.882], // 200m north of destination (should be clipped)
            ],
          },
          properties: { index: 1, distance: 1500, time: 1200 },
        },
      ],
    };

    const client = createTmapPedestrianClient({
      appKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue(Response.json(overshootingResponse)),
    });

    const route = await client.route({
      start: [128.6, 35.87],
      destination: [128.6, 35.88],
      searchOption: "30",
    });

    expect(route.coordinates[0]).toEqual([128.6, 35.87]);
    expect(route.coordinates[route.coordinates.length - 1]).toEqual([128.6, 35.88]);
    expect(route.coordinates).toHaveLength(3);
  });
});
