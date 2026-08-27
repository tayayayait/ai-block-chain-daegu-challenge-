import { describe, expect, it, vi } from "vitest";

import { createPublicError } from "@/lib/error-dto";

import {
  handleMedicationPostRequest,
  type MedicationRouteOperations,
} from "./-medication-post.server";

const subjectId = "00000000-0000-4000-8000-000000000001";

function operations(): MedicationRouteOperations {
  return {
    capture: vi.fn(),
    manual: vi.fn(async () => ({
      kind: "success" as const,
      data: { sessionId: "00000000-0000-4000-8000-000000000002", candidates: [] },
    })),
    enrich: vi.fn(async () => ({
      kind: "success" as const,
      data: { outcome: "SOURCE_UNAVAILABLE", candidate: null },
    })),
    confirm: vi.fn(),
  };
}

describe("medication multipart route handler", () => {
  it("rejects a missing image with a stable public response", async () => {
    const form = new FormData();
    form.set("operation", "capture");
    form.set("subjectId", subjectId);

    const response = await handleMedicationPostRequest(
      new Request(`https://onjung.invalid/medication/${subjectId}`, {
        method: "POST",
        body: form,
      }),
      operations(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });

  it("parses a manual multipart request without echoing its values", async () => {
    const deps = operations();
    const form = new FormData();
    form.set("operation", "manual");
    form.set("subjectId", subjectId);
    form.set("productName", "라식스정");
    form.set("itemSeq", "");
    form.set("ingredientName", "푸로세미드");

    const response = await handleMedicationPostRequest(
      new Request(`https://onjung.invalid/medication/${subjectId}`, {
        method: "POST",
        body: form,
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.manual).toHaveBeenCalledWith({
      subjectId,
      productName: "라식스정",
      itemSeq: "",
      ingredientName: "푸로세미드",
    });
    expect(JSON.stringify(await response.json())).not.toContain("푸로세미드");
  });

  it("rejects malformed confirmation JSON before invoking persistence", async () => {
    const deps = operations();
    const form = new FormData();
    form.set("operation", "confirm");
    form.set("payload", "{not-json");

    const response = await handleMedicationPostRequest(
      new Request(`https://onjung.invalid/medication/${subjectId}`, {
        method: "POST",
        body: form,
      }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });

  it("parses one selected-candidate enrichment request without accepting a candidate payload", async () => {
    const deps = operations();
    const form = new FormData();
    form.set("operation", "enrich");
    form.set("subjectId", subjectId);
    form.set("scanSessionId", "00000000-0000-4000-8000-000000000002");
    form.set("candidateId", "00000000-0000-4000-8000-000000000003");
    form.set("productName", "라식스정");
    form.set("itemSeq", "200000001");
    form.set("ingredientName", "푸로세미드");
    form.set("candidatePayload", JSON.stringify({ mfds: { secret: "never trust client" } }));

    const response = await handleMedicationPostRequest(
      new Request(`https://onjung.invalid/medication/${subjectId}`, {
        method: "POST",
        body: form,
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.enrich).toHaveBeenCalledWith({
      subjectId,
      scanSessionId: "00000000-0000-4000-8000-000000000002",
      candidateId: "00000000-0000-4000-8000-000000000003",
      productName: "라식스정",
      itemSeq: "200000001",
      ingredientName: "푸로세미드",
    });
    expect(deps.enrich).toHaveBeenCalledTimes(1);
  });

  it("returns HTTP 409 when an older review loses the candidate CAS", async () => {
    const deps: MedicationRouteOperations = {
      ...operations(),
      enrich: vi.fn(async () => ({
        kind: "error" as const,
        error: createPublicError("REVIEW_CHANGED"),
      })),
    };
    const form = new FormData();
    form.set("operation", "enrich");
    form.set("subjectId", subjectId);
    form.set("scanSessionId", "00000000-0000-4000-8000-000000000002");
    form.set("candidateId", "00000000-0000-4000-8000-000000000003");
    form.set("productName", "라식스정");
    form.set("itemSeq", "200000001");
    form.set("ingredientName", "푸로세미드");

    const response = await handleMedicationPostRequest(
      new Request(`https://onjung.invalid/medication/${subjectId}`, {
        method: "POST",
        body: form,
      }),
      deps,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: "REVIEW_CHANGED" });
  });
});
