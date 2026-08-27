import { describe, expect, it, vi } from "vitest";

import {
  handleShelterReportPostRequest,
  type ShelterReportRouteOperations,
} from "./-report-post.server";

function reportRequest(overrides: Record<string, string> = {}): Request {
  const form = new FormData();
  const values = {
    shelterId: "DG-0009",
    isOpen: "true",
    crowd: "SPARSE",
    clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return new Request("https://onjung.example/report/DG-0009", { method: "POST", body: form });
}

describe("shelter report route handler", () => {
  it("returns only the safe transaction receipt and forwards the HttpOnly cookie", async () => {
    const operations: ShelterReportRouteOperations = {
      submit: vi.fn(async () => ({
        result: {
          outcome: "ACCEPTED" as const,
          reportId: "223e4567-e89b-42d3-a456-426614174000",
          attest: "UNVERIFIED" as const,
          jobState: "PENDING" as const,
        },
        setCookie: "onjung_reporter=opaque; Path=/; HttpOnly; SameSite=Lax; Secure",
      })),
    };

    const response = await handleShelterReportPostRequest(reportRequest(), operations);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        outcome: "ACCEPTED",
        reportId: "223e4567-e89b-42d3-a456-426614174000",
        attest: "UNVERIFIED",
        jobState: "PENDING",
      },
    });
  });

  it("rejects a path/body shelter mismatch before the transaction", async () => {
    const operations: ShelterReportRouteOperations = { submit: vi.fn() };
    const response = await handleShelterReportPostRequest(
      reportRequest({ shelterId: "DG-0010" }),
      operations,
      "DG-0009",
    );

    expect(response.status).toBe(400);
    expect(operations.submit).not.toHaveBeenCalled();
  });
});
