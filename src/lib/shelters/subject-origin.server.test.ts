import { describe, expect, it, vi } from "vitest";

import {
  createSubjectShelterOriginRepository,
  SubjectShelterOriginError,
} from "./subject-origin.server";

const SUBJECT_ID = "a1000000-0000-4000-8000-000000000001";

describe("subject-scoped shelter origin repository", () => {
  it("loads the authorized subject location through the service-only RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ latitude: 35.8714, longitude: 128.6014 }],
      error: null,
    }));

    await expect(
      createSubjectShelterOriginRepository({ rpc }).findBySubjectId(SUBJECT_ID),
    ).resolves.toEqual({ latitude: 35.8714, longitude: 128.6014 });
    expect(rpc).toHaveBeenCalledWith("get_subject_shelter_origin", {
      p_subject_id: SUBJECT_ID,
    });
  });

  it("rejects malformed identifiers without querying the database", async () => {
    const rpc = vi.fn();

    await expect(
      createSubjectShelterOriginRepository({ rpc }).findBySubjectId("not-a-subject"),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    } satisfies Partial<SubjectShelterOriginError>);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed for missing, invalid, and database responses", async () => {
    const missing = createSubjectShelterOriginRepository({
      rpc: vi.fn(async () => ({ data: [], error: null })),
    });
    const invalid = createSubjectShelterOriginRepository({
      rpc: vi.fn(async () => ({
        data: [{ latitude: "private-row", longitude: 128.6 }],
        error: null,
      })),
    });
    const failed = createSubjectShelterOriginRepository({
      rpc: vi.fn(async () => ({ data: null, error: { message: "secret database error" } })),
    });

    await expect(missing.findBySubjectId(SUBJECT_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(invalid.findBySubjectId(SUBJECT_ID)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(failed.findBySubjectId(SUBJECT_ID)).rejects.toMatchObject({ code: "READ_FAILED" });
  });
});
