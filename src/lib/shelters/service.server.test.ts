import { describe, expect, it, vi } from "vitest";

import { searchShelters } from "./service.server";
import type { ShelterRepository } from "./repository.server";

describe("shelter radius search use case", () => {
  it("validates the URL input, queries once and recommends the next radius when empty", async () => {
    const repository: ShelterRepository = { search: vi.fn(async () => Object.freeze([])) };

    await expect(
      searchShelters(
        new URLSearchParams({ lat: "35.871", lng: "128.601", radius: "500" }),
        repository,
      ),
    ).resolves.toEqual({
      query: {
        lat: 35.871,
        lng: 128.601,
        radius: 500,
        imBank: false,
        open: "ALL",
        sort: "priority",
        limit: 50,
      },
      shelters: [],
      emptyAction: { type: "EXPAND_RADIUS", radius: 1000 },
    });
    expect(repository.search).toHaveBeenCalledTimes(1);
  });

  it("turns malformed coordinates into the shared safe invalid-request error", async () => {
    const repository: ShelterRepository = { search: vi.fn(async () => Object.freeze([])) };

    await expect(
      searchShelters(new URLSearchParams({ lat: "PII", lng: "128.601" }), repository),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(repository.search).not.toHaveBeenCalled();
  });
});
