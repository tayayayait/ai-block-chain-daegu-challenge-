import { describe, expect, it, vi } from "vitest";

import { submitAnonymousShelterReport } from "./service.server";
import type { ShelterReportRepository } from "./repository.server";

const secret = "test-only-secret-that-is-at-least-thirty-two-bytes";
const input = {
  shelterId: "DG-0009",
  isOpen: true,
  clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
} as const;

describe("anonymous report submission service", () => {
  it("keeps the reporter hash inside the server repository call", async () => {
    const submit = vi.fn<ShelterReportRepository["submit"]>(async () => ({
      outcome: "ACCEPTED",
      reportId: "223e4567-e89b-42d3-a456-426614174000",
      attest: "UNVERIFIED",
      jobState: "PENDING",
    }));

    const response = await submitAnonymousShelterReport(
      {
        input,
        cookieHeader: null,
        reporterHashSecret: secret,
        secureCookie: true,
      },
      { submit },
    );

    expect(submit).toHaveBeenCalledWith(input, expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(response.result).toMatchObject({ outcome: "ACCEPTED" });
    expect(response.setCookie).toMatch(/HttpOnly/);
    expect(JSON.stringify(response.result)).not.toMatch(/[0-9a-f]{64}/);
    expect(Object.keys(response).sort()).toEqual(["result", "setCookie"]);
  });

  it("does not replace the cookie on a valid repeat request", async () => {
    const repository: ShelterReportRepository = {
      submit: vi.fn(async () =>
        Object.freeze({
          outcome: "DUPLICATE" as const,
          retryAfter: "2026-08-23T13:10:00.000Z",
        }),
      ),
    };
    const first = await submitAnonymousShelterReport(
      { input, cookieHeader: null, reporterHashSecret: secret, secureCookie: false },
      repository,
    );
    const cookie = first.setCookie?.split(";", 1)[0] ?? null;
    const second = await submitAnonymousShelterReport(
      { input, cookieHeader: cookie, reporterHashSecret: secret, secureCookie: false },
      repository,
    );

    expect(second.setCookie).toBeNull();
  });

  it("rejects malformed public input before issuing a cookie or calling the repository", async () => {
    const repository: ShelterReportRepository = { submit: vi.fn() };

    await expect(
      submitAnonymousShelterReport(
        {
          input: { ...input, shelterId: "raw address" },
          cookieHeader: null,
          reporterHashSecret: secret,
          secureCookie: false,
        },
        repository,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(repository.submit).not.toHaveBeenCalled();
  });
});
