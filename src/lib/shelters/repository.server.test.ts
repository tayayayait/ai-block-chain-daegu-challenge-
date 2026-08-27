import { describe, expect, it, vi } from "vitest";

import { createSupabaseShelterRepository, type ShelterRpcClient } from "./repository.server";
import type { ShelterSearchQuery } from "./search-schema";

const query = {
  lat: 35.871,
  lng: 128.601,
  radius: 500,
  gu: "중구",
  imBank: true,
  open: "OPEN",
  sort: "priority",
  limit: 50,
} as const satisfies ShelterSearchQuery;

const row = {
  shelter_id: "DG-0009",
  shelter_name: "DGB대구은행 중구청지점",
  facility_type: "금융기관",
  gu: "중구",
  is_im_bank: true,
  road_address: "대구광역시 중구 국채보상로139길 1",
  latitude: 35.8707,
  longitude: 128.6063,
  distance_m: 312.4,
  walk_minutes: 7,
  operating_state: "OPEN",
  crowd_level: 0,
  report_observed_at: "2026-08-23T12:30:00.000Z",
  attestation_state: "VERIFIED",
  attestation_uid: "0xabc",
};

function clientReturning(result: {
  readonly data: unknown;
  readonly error: unknown;
}): ShelterRpcClient {
  return {
    rpc: vi.fn(async () => result),
  };
}

describe("Supabase shelter repository", () => {
  it("passes only bounded query values to the server-only PostGIS RPC", async () => {
    const client = clientReturning({ data: [row], error: null });
    const repository = createSupabaseShelterRepository(client);

    await expect(repository.search(query)).resolves.toEqual([
      expect.objectContaining({ id: "DG-0009", distanceM: 312, open: "OPEN" }),
    ]);
    expect(client.rpc).toHaveBeenCalledWith("search_shelters", {
      p_lat: 35.871,
      p_lng: 128.601,
      p_radius_m: 500,
      p_gu: "중구",
      p_im_bank_only: true,
      p_open_state: "OPEN",
      p_sort: "priority",
      p_limit: 50,
    });
  });

  it("expands search radius to 30000m when district filter is selected at default origin", async () => {
    const client = clientReturning({ data: [row], error: null });
    const repository = createSupabaseShelterRepository(client);

    await repository.search({
      lat: 35.8714,
      lng: 128.6014,
      radius: 500,
      gu: "달서구",
      imBank: false,
      open: "ALL",
      sort: "priority",
      limit: 50,
    });

    expect(client.rpc).toHaveBeenCalledWith("search_shelters", {
      p_lat: 35.8714,
      p_lng: 128.6014,
      p_radius_m: 30_000,
      p_gu: "달서구",
      p_im_bank_only: false,
      p_open_state: "ALL",
      p_sort: "priority",
      p_limit: 50,
    });
  });

  it("returns an immutable empty list for a valid zero-result search", async () => {
    const repository = createSupabaseShelterRepository(clientReturning({ data: [], error: null }));
    const result = await repository.search(query);

    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("converts database failures to a safe public error code", async () => {
    const repository = createSupabaseShelterRepository(
      clientReturning({
        data: null,
        error: { message: "contains private diagnostics", code: "XX000" },
      }),
    );

    await expect(repository.search(query)).rejects.toMatchObject({
      code: "SERVER_TEMPORARY",
    });
  });

  it("rejects malformed RPC rows rather than leaking or partially rendering them", async () => {
    const repository = createSupabaseShelterRepository(
      clientReturning({ data: [{ ...row, latitude: "private-corruption" }], error: null }),
    );

    await expect(repository.search(query)).rejects.toMatchObject({
      code: "SERVER_TEMPORARY",
    });
  });
});
