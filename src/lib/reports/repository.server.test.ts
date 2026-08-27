import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseShelterReportRepository,
  type ShelterReportRpcClient,
} from "./repository.server";

const input = {
  shelterId: "DG-0009",
  isOpen: true,
  crowd: "SPARSE",
  clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
} as const;
const reporterHash = "a".repeat(64);

function clientReturning(result: {
  readonly data: unknown;
  readonly error: unknown;
}): ShelterReportRpcClient {
  return { rpc: vi.fn(async () => result) };
}

describe("Supabase anonymous shelter report repository", () => {
  it("submits only an HMAC reporter reference and maps the accepted state", async () => {
    const client = clientReturning({
      data: [
        {
          outcome: "ACCEPTED",
          report_id: "223e4567-e89b-42d3-a456-426614174000",
          retry_after: null,
          attestation_state: "UNVERIFIED",
          attestation_job_state: "PENDING",
        },
      ],
      error: null,
    });
    const repository = createSupabaseShelterReportRepository(client);

    await expect(repository.submit(input, reporterHash)).resolves.toEqual({
      outcome: "ACCEPTED",
      reportId: "223e4567-e89b-42d3-a456-426614174000",
      attest: "UNVERIFIED",
      jobState: "PENDING",
    });
    expect(client.rpc).toHaveBeenCalledWith("submit_shelter_report", {
      p_shelter_id: "DG-0009",
      p_is_open: true,
      p_crowd_level: 0,
      p_reporter_hash: reporterHash,
      p_client_request_id: input.clientRequestId,
    });
    expect(JSON.stringify(await repository.submit(input, reporterHash))).not.toContain(
      reporterHash,
    );
  });

  it.each(["DUPLICATE", "RATE_LIMITED"] as const)(
    "maps %s to a retryable-at response without a report identifier",
    async (outcome) => {
      const repository = createSupabaseShelterReportRepository(
        clientReturning({
          data: [
            {
              outcome,
              report_id: null,
              retry_after: "2026-08-23T13:10:00.000Z",
              attestation_state: "UNVERIFIED",
              attestation_job_state: "PENDING",
            },
          ],
          error: null,
        }),
      );

      await expect(repository.submit(input, reporterHash)).resolves.toEqual({
        outcome,
        retryAfter: "2026-08-23T13:10:00.000Z",
      });
    },
  );

  it.each([
    ["23503", "NOT_FOUND"],
    ["22023", "INVALID_REQUEST"],
    ["XX000", "SERVER_TEMPORARY"],
  ] as const)("maps database code %s to safe app error %s", async (code, expected) => {
    const repository = createSupabaseShelterReportRepository(
      clientReturning({ data: null, error: { code, message: "private" } }),
    );

    await expect(repository.submit(input, reporterHash)).rejects.toMatchObject({
      code: expected,
    });
  });

  it("rejects a missing or forged multi-row RPC result", async () => {
    const repository = createSupabaseShelterReportRepository(
      clientReturning({ data: [], error: null }),
    );

    await expect(repository.submit(input, reporterHash)).rejects.toMatchObject({
      code: "SERVER_TEMPORARY",
    });
  });
});
