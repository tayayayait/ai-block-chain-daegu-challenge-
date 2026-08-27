import { describe, expect, it, vi } from "vitest";

import { getShelterById } from "./lookup.server";
import {
  createSupabaseShelterRepository,
  type ShelterLookupRepository,
  type ShelterRpcClient,
} from "./repository.server";

const row = {
  shelter_id: "DG-0009",
  shelter_name: "DGB대구은행 중구청지점",
  facility_type: "금융기관",
  gu: "중구",
  is_im_bank: true,
  road_address: "대구광역시 중구 국채보상로139길 1",
  latitude: 35.8707,
  longitude: 128.6063,
  kma_nx: 89,
  reporter_hash: "must-not-leak",
};

function clientReturning(result: {
  readonly data: unknown;
  readonly error: unknown;
}): ShelterRpcClient {
  return { rpc: vi.fn(async () => result) };
}

describe("server-only shelter report target lookup", () => {
  it("returns only the strict public allowlist and calls the service-role RPC", async () => {
    const client = clientReturning({ data: [row], error: null });
    const repository = createSupabaseShelterRepository(client);

    await expect(getShelterById("DG-0009", repository)).resolves.toEqual({
      id: "DG-0009",
      name: "DGB대구은행 중구청지점",
      facilityType: "금융기관",
      gu: "중구",
      isImBank: true,
      roadAddress: "대구광역시 중구 국채보상로139길 1",
      latitude: 35.8707,
      longitude: 128.6063,
    });
    expect(client.rpc).toHaveBeenCalledWith("get_shelter_by_id", {
      p_shelter_id: "DG-0009",
    });
    expect(JSON.stringify(await getShelterById("DG-0009", repository))).not.toMatch(
      /kma_nx|reporter_hash|must-not-leak/,
    );
  });

  it("returns NOT_FOUND only for a valid identifier with no row", async () => {
    const repository = createSupabaseShelterRepository(clientReturning({ data: [], error: null }));

    await expect(getShelterById("DG-9999", repository)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns SERVER_TEMPORARY for a provider failure without exposing diagnostics", async () => {
    const repository = createSupabaseShelterRepository(
      clientReturning({ data: null, error: { code: "XX000", message: "private provider SQL" } }),
    );

    await expect(getShelterById("DG-0009", repository)).rejects.toMatchObject({
      code: "SERVER_TEMPORARY",
      message: "SERVER_TEMPORARY",
    });
  });

  it("rejects malformed route identifiers before the repository call", async () => {
    const repository: ShelterLookupRepository = { getById: vi.fn() };

    await expect(getShelterById("full address or raw id", repository)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(repository.getById).not.toHaveBeenCalled();
  });
});
