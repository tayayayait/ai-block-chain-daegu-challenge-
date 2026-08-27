import { describe, expect, it, vi } from "vitest";

import type { MedicationApiCacheEntry, MedicationApiCacheRepository } from "./cache.server";

describe("Supabase MFDS cache repository", () => {
  it("reads only an unexpired cache row and upserts by api kind plus request hash", async () => {
    const cachedResponse = { header: { resultCode: "00" }, body: { items: [] } };
    const maybeSingle = vi.fn(async () => ({
      data: {
        api_kind: "E_DRUG",
        request_hash: "a".repeat(64),
        response: cachedResponse,
        fetched_at: "2026-08-01T00:00:00.000Z",
        expires_at: "2026-09-01T00:00:00.000Z",
      },
      error: null,
    }));
    const findQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    findQuery["select"] = vi.fn(() => findQuery);
    findQuery["eq"] = vi.fn(() => findQuery);
    findQuery["gt"] = vi.fn(() => findQuery);
    findQuery["maybeSingle"] = maybeSingle;
    const upsert = vi.fn(async () => ({ data: null, error: null }));
    const from = vi.fn().mockReturnValueOnce(findQuery).mockReturnValueOnce({ upsert });
    const module = await import("./cache.server");
    const createRepository = Reflect.get(module, "createSupabaseMedicationApiCacheRepository") as
      ((client: unknown) => MedicationApiCacheRepository) | undefined;

    expect(createRepository).toBeTypeOf("function");
    if (!createRepository) return;
    const repository = createRepository({ from });
    const now = new Date("2026-08-24T00:00:00.000Z");
    const requestHash = "a".repeat(64);

    await expect(repository.findFresh({ apiKind: "E_DRUG", requestHash, now })).resolves.toEqual(
      cachedResponse,
    );
    expect(findQuery["gt"]).toHaveBeenCalledWith("expires_at", now.toISOString());

    const entry: MedicationApiCacheEntry = {
      apiKind: "E_DRUG",
      requestHash,
      response: cachedResponse,
      fetchedAt: new Date("2026-08-24T00:00:00.000Z"),
      expiresAt: new Date("2026-09-23T00:00:00.000Z"),
    };
    await repository.save(entry);

    expect(upsert).toHaveBeenCalledWith(
      {
        api_kind: "E_DRUG",
        request_hash: requestHash,
        response: cachedResponse,
        fetched_at: entry.fetchedAt.toISOString(),
        expires_at: entry.expiresAt.toISOString(),
      },
      { onConflict: "api_kind,request_hash" },
    );
  });
});
