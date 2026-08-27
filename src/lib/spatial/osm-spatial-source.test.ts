import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  assembleDaeguBoundary,
  assembleServiceCoverageBoundary,
  buildOverpassQuery,
  collectOsmSpatialData,
  fetchOverpassJson,
  normalizeOsmDataset,
  parseOverpassResponse,
  type OsmArtifactBundle,
  writeOsmArtifactBundle,
} from "../../../scripts/fetch-osm-spatial-data";
import { prepareSpatialImport } from "../../../scripts/import-spatial-data";

const envelope = (elements: unknown[], extra: Record<string, unknown> = {}) => ({
  version: 0.6,
  generator: "Overpass API 0.7.62",
  osm3s: {
    timestamp_osm_base: "2026-08-24T00:00:00Z",
    copyright: "OpenStreetMap contributors",
  },
  elements,
  ...extra,
});

const SERVICE_DISTRICT_IDS = [
  3_891_544, 3_959_027, 3_966_394, 3_966_426, 3_969_938, 3_970_414, 3_972_089, 3_972_253,
] as const;

function serviceBoundaryElements(): unknown[] {
  return SERVICE_DISTRICT_IDS.flatMap((id, index) => {
    const wayId = 1_000 + index;
    const firstNode = 10_000 + index * 10;
    const longitude = index === 0 ? 128.55 : 128.35 + ((index - 1) % 4) * 0.08;
    const latitude = index === 0 ? 35.75 : 35.9 + Math.floor((index - 1) / 4) * 0.05;
    const size = index === 0 ? 0.1 : 0.03;
    return [
      {
        type: "relation",
        id,
        tags: { boundary: "administrative", admin_level: "6" },
        members: [{ type: "way", ref: wayId, role: "outer" }],
      },
      {
        type: "way",
        id: wayId,
        nodes: [firstNode, firstNode + 1, firstNode + 2, firstNode + 3, firstNode],
        geometry: [
          { lat: latitude, lon: longitude },
          { lat: latitude + size, lon: longitude },
          { lat: latitude + size, lon: longitude + size },
          { lat: latitude, lon: longitude + size },
          { lat: latitude, lon: longitude },
        ],
      },
    ];
  });
}

describe("OSM spatial source", () => {
  it("accepts a complete Overpass JSON envelope", () => {
    const parsed = parseOverpassResponse(envelope([]));

    expect(parsed.generator).toBe("Overpass API 0.7.62");
    expect(parsed.osm3s.timestamp_osm_base).toBe("2026-08-24T00:00:00Z");
  });

  it("assembles the declared outer ways without inventing boundary coordinates", () => {
    const parsed = parseOverpassResponse(
      envelope([
        {
          type: "relation",
          id: 2_395_674,
          tags: { boundary: "administrative", admin_level: "4" },
          members: [
            { type: "way", ref: 11, role: "outer" },
            { type: "way", ref: 12, role: "outer" },
            { type: "relation", ref: 99, role: "subarea" },
            { type: "node", ref: 100, role: "admin_centre" },
          ],
        },
        {
          type: "way",
          id: 11,
          nodes: [1, 2, 3],
          geometry: [
            { lat: 35.8, lon: 128.5 },
            { lat: 35.9, lon: 128.6 },
            { lat: 35.8, lon: 128.7 },
          ],
        },
        {
          type: "way",
          id: 12,
          nodes: [3, 4, 1],
          geometry: [
            { lat: 35.8, lon: 128.7 },
            { lat: 35.7, lon: 128.6 },
            { lat: 35.8, lon: 128.5 },
          ],
        },
      ]),
    );

    expect(assembleDaeguBoundary(parsed)).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [128.5, 35.8],
          [128.6, 35.9],
          [128.7, 35.8],
          [128.6, 35.7],
          [128.5, 35.8],
        ],
      ],
    });
  });

  it("fails closed when the relation declares an inner boundary", () => {
    const parsed = parseOverpassResponse(
      envelope([
        {
          type: "relation",
          id: 2_395_674,
          tags: { boundary: "administrative", admin_level: "4" },
          members: [{ type: "way", ref: 11, role: "inner" }],
        },
      ]),
    );

    expect(() => assembleDaeguBoundary(parsed)).toThrow(/inner/u);
  });

  it("fails closed when two outer ways can continue the same chain", () => {
    const parsed = parseOverpassResponse(
      envelope([
        {
          type: "relation",
          id: 2_395_674,
          tags: { boundary: "administrative", admin_level: "4" },
          members: [
            { type: "way", ref: 11, role: "outer" },
            { type: "way", ref: 12, role: "outer" },
            { type: "way", ref: 13, role: "outer" },
          ],
        },
        {
          type: "way",
          id: 11,
          nodes: [1, 2],
          geometry: [
            { lat: 35.8, lon: 128.5 },
            { lat: 35.9, lon: 128.6 },
          ],
        },
        {
          type: "way",
          id: 12,
          nodes: [2, 3],
          geometry: [
            { lat: 35.9, lon: 128.6 },
            { lat: 35.8, lon: 128.7 },
          ],
        },
        {
          type: "way",
          id: 13,
          nodes: [2, 4],
          geometry: [
            { lat: 35.9, lon: 128.6 },
            { lat: 35.7, lon: 128.6 },
          ],
        },
      ]),
    );

    expect(() => assembleDaeguBoundary(parsed)).toThrow(/ambiguous/u);
  });

  it("builds the service coverage from the documented eight districts and excludes Gunwi", () => {
    const elements = serviceBoundaryElements();

    expect(assembleServiceCoverageBoundary(parseOverpassResponse(envelope(elements)))).toEqual(
      expect.objectContaining({ type: "MultiPolygon", coordinates: expect.any(Array) }),
    );
    const coverage = assembleServiceCoverageBoundary(parseOverpassResponse(envelope(elements)));
    expect(coverage.type === "MultiPolygon" ? coverage.coordinates : []).toHaveLength(8);
    expect(buildOverpassQuery("BOUNDARY")).not.toContain("7816959");
    for (const id of SERVICE_DISTRICT_IDS) {
      expect(buildOverpassQuery("BOUNDARY")).toContain(String(id));
    }
  });

  it("keeps only closed building ways with a strict height or positive integer levels", () => {
    const response = parseOverpassResponse(
      envelope([
        {
          type: "way",
          id: 21,
          timestamp: "2026-08-23T23:00:00Z",
          nodes: [1, 2, 3, 1],
          tags: { building: "yes", height: "12.5 m" },
          geometry: [
            { lat: 35.79, lon: 128.59 },
            { lat: 35.8, lon: 128.6 },
            { lat: 35.79, lon: 128.61 },
            { lat: 35.79, lon: 128.59 },
          ],
        },
        {
          type: "way",
          id: 22,
          timestamp: "2026-08-23T22:00:00Z",
          nodes: [4, 5, 6, 4],
          tags: { building: "apartments", "building:levels": "4" },
          geometry: [
            { lat: 35.78, lon: 128.59 },
            { lat: 35.785, lon: 128.6 },
            { lat: 35.78, lon: 128.61 },
            { lat: 35.78, lon: 128.59 },
          ],
        },
        {
          type: "way",
          id: 23,
          nodes: [7, 8, 9, 7],
          tags: { building: "yes", "building:levels": "2.5" },
          geometry: [
            { lat: 35.77, lon: 128.59 },
            { lat: 35.775, lon: 128.6 },
            { lat: 35.77, lon: 128.61 },
            { lat: 35.77, lon: 128.59 },
          ],
        },
        {
          type: "way",
          id: 24,
          nodes: [10, 11, 12],
          tags: { building: "yes", height: "9" },
          geometry: [
            { lat: 35.76, lon: 128.59 },
            { lat: 35.765, lon: 128.6 },
            { lat: 35.76, lon: 128.61 },
          ],
        },
      ]),
    );
    const artifacts = normalizeOsmDataset("BUILDING", response, {
      type: "Polygon",
      coordinates: [
        [
          [128.5, 35.8],
          [128.6, 35.9],
          [128.7, 35.8],
          [128.6, 35.7],
          [128.5, 35.8],
        ],
      ],
    });

    expect(artifacts.geojson.features).toHaveLength(2);
    expect(artifacts.geojson.features.map((feature) => feature.properties)).toEqual([
      {
        sourceFeatureId: "osm-way-21",
        observedAt: "2026-08-23T23:00:00Z",
        heightM: 12.5,
        heightSource: "OSM_HEIGHT_TAG",
      },
      {
        sourceFeatureId: "osm-way-22",
        observedAt: "2026-08-23T22:00:00Z",
        floorCount: 4,
      },
    ]);
    expect(artifacts.counts.excludedByReason).toEqual({
      INVALID_HEIGHT_AND_LEVELS: 1,
      OPEN_BUILDING_WAY: 1,
    });
    expect(artifacts.manifest["confidence"]).toBe("DERIVED");
  });

  it("maps only bench and explicitly supported shelter nodes", () => {
    const response = parseOverpassResponse(
      envelope([
        {
          type: "node",
          id: 31,
          lat: 35.8,
          lon: 128.6,
          tags: { amenity: "bench" },
        },
        {
          type: "node",
          id: 32,
          lat: 35.81,
          lon: 128.6,
          tags: { amenity: "shelter", shelter_type: "sun_shelter" },
        },
        {
          type: "node",
          id: 33,
          lat: 35.82,
          lon: 128.6,
          tags: { amenity: "shelter", shelter_type: "gazebo" },
        },
        {
          type: "node",
          id: 34,
          lat: 35.83,
          lon: 128.6,
          tags: { amenity: "shelter" },
        },
        {
          type: "way",
          id: 35,
          nodes: [1, 2, 3, 1],
          tags: { amenity: "shelter", shelter_type: "pavilion" },
          geometry: [
            { lat: 35.8, lon: 128.6 },
            { lat: 35.81, lon: 128.61 },
            { lat: 35.8, lon: 128.62 },
            { lat: 35.8, lon: 128.6 },
          ],
        },
      ]),
    );
    const artifacts = normalizeOsmDataset("REST_SPOT", response, {
      type: "Polygon",
      coordinates: [
        [
          [128.5, 35.8],
          [128.6, 35.9],
          [128.7, 35.8],
          [128.6, 35.7],
          [128.5, 35.8],
        ],
      ],
    });

    expect(artifacts.geojson.features.map((feature) => feature.properties["restType"])).toEqual([
      "BENCH",
      "SHADE_CANOPY",
      "PAVILION",
    ]);
    expect(artifacts.geojson.features.every((feature) => feature.geometry.type === "Point")).toBe(
      true,
    );
    expect(artifacts.counts.excludedByReason).toEqual({
      SHELTER_TYPE_NOT_ALLOWED: 1,
      NON_NODE_REST_SPOT: 1,
    });
    expect(artifacts.manifest["confidence"]).toBe("COMMUNITY");
  });

  it("maps only OSM steps ways and never creates a slope value", () => {
    const response = parseOverpassResponse(
      envelope([
        {
          type: "way",
          id: 41,
          timestamp: "2026-08-23T21:00:00Z",
          nodes: [1, 2],
          tags: { highway: "steps" },
          geometry: [
            { lat: 35.8, lon: 128.59 },
            { lat: 35.8, lon: 128.61 },
          ],
        },
        {
          type: "way",
          id: 42,
          nodes: [2, 3],
          tags: { highway: "footway" },
          geometry: [
            { lat: 35.8, lon: 128.61 },
            { lat: 35.8, lon: 128.62 },
          ],
        },
      ]),
    );
    const artifacts = normalizeOsmDataset("BARRIER", response, {
      type: "Polygon",
      coordinates: [
        [
          [128.5, 35.8],
          [128.6, 35.9],
          [128.7, 35.8],
          [128.6, 35.7],
          [128.5, 35.8],
        ],
      ],
    });

    expect(artifacts.geojson.features).toEqual([
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [128.59, 35.8],
            [128.61, 35.8],
          ],
        },
        properties: {
          sourceFeatureId: "osm-way-41",
          observedAt: "2026-08-23T21:00:00Z",
          barrierType: "STAIRS",
        },
      },
    ]);
    expect(artifacts.counts.excludedByReason).toEqual({ NOT_STEPS_WAY: 1 });
  });

  it("excludes a source feature that only intersects but is not within service coverage", () => {
    const response = parseOverpassResponse(
      envelope([
        {
          type: "way",
          id: 45,
          nodes: [1, 2],
          tags: { highway: "steps" },
          geometry: [
            { lat: 35.8, lon: 128.59 },
            { lat: 35.8, lon: 128.8 },
          ],
        },
      ]),
    );
    const artifacts = normalizeOsmDataset("BARRIER", response, {
      type: "Polygon",
      coordinates: [
        [
          [128.5, 35.7],
          [128.7, 35.7],
          [128.7, 35.9],
          [128.5, 35.9],
          [128.5, 35.7],
        ],
      ],
    });

    expect(artifacts.geojson.features).toHaveLength(0);
    expect(artifacts.counts.excludedByReason).toEqual({ OUTSIDE_SERVICE_COVERAGE: 1 });
  });

  it.each(["BUILDING", "REST_SPOT", "BARRIER"] as const)(
    "produces a %s artifact accepted by the existing importer dry-run",
    (dataset) => {
      const sourceElements = {
        BUILDING: [
          {
            type: "way",
            id: 51,
            nodes: [1, 2, 3, 1],
            tags: { building: "yes", height: "10" },
            geometry: [
              { lat: 35.79, lon: 128.59 },
              { lat: 35.8, lon: 128.6 },
              { lat: 35.79, lon: 128.61 },
              { lat: 35.79, lon: 128.59 },
            ],
          },
        ],
        REST_SPOT: [
          {
            type: "node",
            id: 52,
            lat: 35.8,
            lon: 128.6,
            tags: { amenity: "bench" },
          },
        ],
        BARRIER: [
          {
            type: "way",
            id: 53,
            nodes: [1, 2],
            tags: { highway: "steps" },
            geometry: [
              { lat: 35.8, lon: 128.59 },
              { lat: 35.8, lon: 128.61 },
            ],
          },
        ],
      } as const;
      const artifacts = normalizeOsmDataset(
        dataset,
        parseOverpassResponse(envelope([...sourceElements[dataset]])),
        {
          type: "Polygon",
          coordinates: [
            [
              [128.5, 35.8],
              [128.6, 35.9],
              [128.7, 35.8],
              [128.6, 35.7],
              [128.5, 35.8],
            ],
          ],
        },
      );

      const prepared = prepareSpatialImport(
        { manifest: artifacts.manifest, geojson: artifacts.geojson },
        new Date("2026-08-24T01:00:00Z"),
      );
      expect(prepared.ok, JSON.stringify(prepared.audit.issues)).toBe(true);
      expect(prepared.audit.acceptedCount).toBe(1);
    },
  );

  it("fetches Overpass with POST, an explicit User-Agent, and an encoded query", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const result = await fetchOverpassJson("[out:json];node(1);out;", {
      endpoints: ["https://overpass.example/api/interpreter"],
      maxAttempts: 1,
      maxResponseBytes: 10_000,
      fetchImpl: async (input, init) => {
        requests.push(
          init === undefined ? { input: String(input) } : { input: String(input), init },
        );
        return new Response(JSON.stringify(envelope([])), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe("https://overpass.example/api/interpreter");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(new Headers(requests[0]?.init?.headers).get("user-agent")).toMatch(
      /Daegu.*Spatial.*ETL/iu,
    );
    expect(String(requests[0]?.init?.body)).toBe(
      `data=${encodeURIComponent("[out:json];node(1);out;")}`,
    );
    expect(result.document.elements).toEqual([]);
    expect(result.rawBytes.byteLength).toBeGreaterThan(0);
  });

  it("retries only a bounded number of transient Overpass failures with backoff", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await fetchOverpassJson("[out:json];node(1);out;", {
      endpoints: ["https://one.example/api", "https://two.example/api"],
      maxAttempts: 3,
      initialBackoffMs: 25,
      maxResponseBytes: 10_000,
      fetchImpl: async () => {
        attempts += 1;
        return attempts < 3
          ? new Response("busy", { status: 503 })
          : new Response(JSON.stringify(envelope([])), { status: 200 });
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    expect(attempts).toBe(3);
    expect(delays).toEqual([25, 50]);
    expect(result.endpoint).toBe("https://one.example/api");
  });

  it("rejects an Overpass response as soon as it exceeds the byte ceiling", async () => {
    await expect(
      fetchOverpassJson("[out:json];node(1);out;", {
        endpoints: ["https://overpass.example/api"],
        maxAttempts: 1,
        maxResponseBytes: 8,
        fetchImpl: async () =>
          new Response(JSON.stringify(envelope([])), {
            status: 200,
            headers: { "content-length": "999" },
          }),
      }),
    ).rejects.toThrow(/byte ceiling/u);
  });

  it("rejects a 200 response containing an Overpass runtime remark", () => {
    expect(() =>
      parseOverpassResponse(envelope([], { remark: "runtime error: Query timed out" })),
    ).toThrow(/remark/u);
  });

  it.each(["BOUNDARY", "BUILDING", "REST_SPOT", "BARRIER"] as const)(
    "builds a relation-scoped %s Overpass query with source metadata",
    (dataset) => {
      const query = buildOverpassQuery(dataset);

      expect(query).toContain("rel(id:");
      for (const id of SERVICE_DISTRICT_IDS) expect(query).toContain(String(id));
      expect(query).not.toContain("7816959");
      expect(query).toContain("out meta");
      expect(query).not.toContain("out center");
      if (dataset === "BUILDING") {
        expect(query).toContain('["building"]["height"]');
        expect(query).toContain('["building"]["building:levels"]');
      }
      if (dataset === "REST_SPOT") {
        expect(query).toContain('["amenity"="bench"]');
        expect(query).toContain('["amenity"="shelter"]');
      }
      if (dataset === "BARRIER") expect(query).toContain('["highway"="steps"]');
    },
  );

  it("writes raw gzip snapshots, checksums, manifests, GeoJSON, audits, and provenance", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "daegu-osm-artifacts-"));
    const outputDirectory = join(temporaryRoot, "snapshot");
    const coverageGeometry = {
      type: "Polygon" as const,
      coordinates: [
        [
          [128.5, 35.8] as [number, number],
          [128.6, 35.9] as [number, number],
          [128.7, 35.8] as [number, number],
          [128.6, 35.7] as [number, number],
          [128.5, 35.8] as [number, number],
        ],
      ],
    };
    const documents = {
      BOUNDARY: parseOverpassResponse(envelope([])),
      BUILDING: parseOverpassResponse(
        envelope([
          {
            type: "way",
            id: 61,
            nodes: [1, 2, 3, 1],
            tags: { building: "yes", height: "10" },
            geometry: [
              { lat: 35.79, lon: 128.59 },
              { lat: 35.8, lon: 128.6 },
              { lat: 35.79, lon: 128.61 },
              { lat: 35.79, lon: 128.59 },
            ],
          },
        ]),
      ),
      REST_SPOT: parseOverpassResponse(
        envelope([
          {
            type: "node",
            id: 62,
            lat: 35.8,
            lon: 128.6,
            tags: { amenity: "bench" },
          },
        ]),
      ),
      BARRIER: parseOverpassResponse(
        envelope([
          {
            type: "way",
            id: 63,
            nodes: [1, 2],
            tags: { highway: "steps" },
            geometry: [
              { lat: 35.8, lon: 128.59 },
              { lat: 35.8, lon: 128.61 },
            ],
          },
        ]),
      ),
    };
    const fetched = Object.fromEntries(
      Object.entries(documents).map(([dataset, document]) => {
        const rawBytes = new TextEncoder().encode(JSON.stringify(document));
        return [
          dataset,
          {
            document,
            rawBytes,
            endpoint: "https://overpass.example/api/interpreter",
            attempts: 1,
            fetchedAt: "2026-08-24T01:00:00.000Z",
          },
        ];
      }),
    ) as Record<keyof typeof documents, Awaited<ReturnType<typeof fetchOverpassJson>>>;

    const datasets = Object.fromEntries(
      (["BUILDING", "REST_SPOT", "BARRIER"] as const).map((dataset) => {
        const rawSha256 = createHash("sha256").update(fetched[dataset].rawBytes).digest("hex");
        const artifacts = normalizeOsmDataset(
          dataset,
          documents[dataset],
          coverageGeometry,
          rawSha256,
        );
        const prepared = prepareSpatialImport(
          { manifest: artifacts.manifest, geojson: artifacts.geojson },
          new Date("2026-08-24T01:00:00Z"),
        );
        return [
          dataset,
          {
            query: buildOverpassQuery(dataset),
            fetched: fetched[dataset],
            artifacts,
            audit: prepared.audit,
          },
        ];
      }),
    ) as unknown as OsmArtifactBundle["datasets"];

    try {
      const result = await writeOsmArtifactBundle(outputDirectory, {
        generatedAt: "2026-08-24T01:05:00.000Z",
        boundary: {
          query: buildOverpassQuery("BOUNDARY"),
          fetched: fetched.BOUNDARY,
          coverageGeometry,
        },
        datasets,
      });

      const rawBuilding = fetched.BUILDING.rawBytes;
      const storedBuilding = gunzipSync(
        await readFile(join(outputDirectory, "raw", "building.json.gz")),
      );
      expect(storedBuilding).toEqual(Buffer.from(rawBuilding));
      expect(result.provenance.sources.BUILDING.rawSha256).toBe(
        createHash("sha256").update(rawBuilding).digest("hex"),
      );
      expect(result.provenance.sources.BUILDING.rawBytes).toBe(rawBuilding.byteLength);
      expect(result.provenance.sources.BUILDING.query).toBe(buildOverpassQuery("BUILDING"));
      expect(result.provenance.sources.BUILDING.querySha256).toHaveLength(64);
      expect(result.provenance.sources.BUILDING.counts["accepted"]).toBe(1);
      expect(
        JSON.parse(await readFile(join(outputDirectory, "building-manifest.json"), "utf8")),
      ).toEqual(datasets.BUILDING.artifacts.manifest);
      expect(
        JSON.parse(await readFile(join(outputDirectory, "building-features.geojson"), "utf8")),
      ).toEqual(datasets.BUILDING.artifacts.geojson);
      expect(
        JSON.parse(await readFile(join(outputDirectory, "building-audit.json"), "utf8")),
      ).toEqual(datasets.BUILDING.audit);
      expect(JSON.parse(await readFile(join(outputDirectory, "provenance.json"), "utf8"))).toEqual(
        result.provenance,
      );
      expect(String(datasets.BUILDING.artifacts.manifest["version"])).toContain(
        result.provenance.sources.BUILDING.rawSha256.slice(0, 12),
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("collects the boundary and three datasets sequentially and dry-runs every artifact", async () => {
    const boundaryDocument = parseOverpassResponse(envelope(serviceBoundaryElements()));
    const datasetDocuments = {
      BUILDING: parseOverpassResponse(
        envelope([
          {
            type: "way",
            id: 73,
            nodes: [1, 2, 3, 1],
            tags: { building: "yes", "building:levels": "3" },
            geometry: [
              { lat: 35.79, lon: 128.59 },
              { lat: 35.8, lon: 128.6 },
              { lat: 35.79, lon: 128.61 },
              { lat: 35.79, lon: 128.59 },
            ],
          },
        ]),
      ),
      REST_SPOT: parseOverpassResponse(
        envelope([
          {
            type: "node",
            id: 74,
            lat: 35.8,
            lon: 128.6,
            tags: { amenity: "bench" },
          },
        ]),
      ),
      BARRIER: parseOverpassResponse(
        envelope([
          {
            type: "way",
            id: 75,
            nodes: [1, 2],
            tags: { highway: "steps" },
            geometry: [
              { lat: 35.8, lon: 128.59 },
              { lat: 35.8, lon: 128.61 },
            ],
          },
        ]),
      ),
    };
    const calls: string[] = [];
    const fetchQuery = async (query: string) => {
      calls.push(query);
      const document =
        query === buildOverpassQuery("BOUNDARY")
          ? boundaryDocument
          : query.includes('["building"]')
            ? datasetDocuments.BUILDING
            : query.includes('["amenity"')
              ? datasetDocuments.REST_SPOT
              : datasetDocuments.BARRIER;
      return {
        document,
        rawBytes: new TextEncoder().encode(JSON.stringify(document)),
        endpoint: "https://overpass.example/api/interpreter",
        attempts: 1,
        fetchedAt: "2026-08-24T01:00:00.000Z",
      };
    };

    const bundle = await collectOsmSpatialData({
      auditedAt: new Date("2026-08-24T01:05:00.000Z"),
      fetchQuery,
    });

    expect(calls).toEqual([
      buildOverpassQuery("BOUNDARY"),
      buildOverpassQuery("BUILDING"),
      buildOverpassQuery("REST_SPOT"),
      buildOverpassQuery("BARRIER"),
    ]);
    expect(bundle.datasets.BUILDING.audit.ok).toBe(true);
    expect(bundle.datasets.REST_SPOT.audit.ok).toBe(true);
    expect(bundle.datasets.BARRIER.audit.ok).toBe(true);
    expect(String(bundle.datasets.BUILDING.artifacts.manifest["version"])).toMatch(
      /[0-9a-f]{12}$/u,
    );
  });
});
