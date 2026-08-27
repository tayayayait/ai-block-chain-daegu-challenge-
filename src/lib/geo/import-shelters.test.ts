import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { applyShelterImport, prepareShelterImport } from "../../../scripts/import-shelters.ts";
import type { ShelterFeatureCollection } from "../../../scripts/prepare-shelters.ts";

const collection = JSON.parse(
  readFileSync(resolve(process.cwd(), "data", "daegu_shelters.geojson"), "utf8"),
) as ShelterFeatureCollection;
const importedAt = new Date("2026-08-24T00:00:00.000Z");

describe("official Daegu shelter importer", () => {
  it("maps all 950 audited features to PostGIS rows without adding demo data", () => {
    const prepared = prepareShelterImport(collection, importedAt);

    expect(prepared.rows).toHaveLength(950);
    expect(prepared.importedAt).toBe(importedAt.toISOString());
    expect(prepared.rows[0]).toEqual(
      expect.objectContaining({
        id: "DG-0002",
        source_geo_idn: "2",
        geocode_result: "SUCC",
      }),
    );
    expect(prepared.rows[0]?.location).toMatch(/^POINT\(128\.\d+ 35\.\d+\)$/u);
    expect(new Set(prepared.rows.map((row) => row.id)).size).toBe(950);
  });

  it("upserts the validated rows in one request and verifies the remote exact count", async () => {
    const prepared = prepareShelterImport(collection, importedAt);
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 201 });
      return new Response(null, {
        status: 200,
        headers: { "content-range": "0-0/950" },
      });
    });

    await expect(
      applyShelterImport(prepared, {
        supabaseUrl: "https://project-ref.supabase.co/",
        secretKey: "fixture-service-key",
        fetcher,
      }),
    ).resolves.toEqual({ importedCount: 950, verifiedCount: 950 });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [upsertUrl, upsertInit] = fetcher.mock.calls[0] ?? [];
    expect(String(upsertUrl)).toBe(
      "https://project-ref.supabase.co/rest/v1/shelters?on_conflict=id",
    );
    expect(upsertInit?.method).toBe("POST");
    expect(upsertInit?.headers).toEqual(
      expect.objectContaining({
        apikey: "fixture-service-key",
        Authorization: "Bearer fixture-service-key",
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
    );
    expect(JSON.parse(String(upsertInit?.body))).toHaveLength(950);
  });

  it("fails closed when the remote table does not contain exactly the audited 950 rows", async () => {
    const prepared = prepareShelterImport(collection, importedAt);
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 201 });
      return new Response(null, {
        status: 200,
        headers: { "content-range": "0-0/949" },
      });
    });

    await expect(
      applyShelterImport(prepared, {
        supabaseUrl: "https://project-ref.supabase.co/",
        secretKey: "fixture-service-key",
        fetcher,
      }),
    ).rejects.toThrow("expected 950 rows but found 949");
  });
});
