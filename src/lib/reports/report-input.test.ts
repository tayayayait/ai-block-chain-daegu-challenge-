import { describe, expect, it } from "vitest";

import { parseShelterReportInput, ShelterReportInputSchema } from "./report-input";

describe("anonymous shelter report input", () => {
  it("parses the public radio values and optional crowd level", () => {
    expect(
      parseShelterReportInput({
        shelterId: "DG-0009",
        isOpen: "true",
        crowd: "SPARSE",
        clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
      }),
    ).toEqual({
      shelterId: "DG-0009",
      isOpen: true,
      crowd: "SPARSE",
      clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it("does not invent a crowd answer when it was omitted", () => {
    expect(
      parseShelterReportInput({
        shelterId: "DG-0009",
        isOpen: false,
        clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
      }),
    ).toEqual({
      shelterId: "DG-0009",
      isOpen: false,
      clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it.each([
    { shelterId: "9", isOpen: true, clientRequestId: crypto.randomUUID() },
    { shelterId: "DG-0009", isOpen: "yes", clientRequestId: crypto.randomUUID() },
    { shelterId: "DG-0009", isOpen: true, crowd: "NORMAL", clientRequestId: crypto.randomUUID() },
    { shelterId: "DG-0009", isOpen: true, clientRequestId: "not-a-uuid" },
  ])("rejects malformed report input %#", (input) => {
    expect(ShelterReportInputSchema.safeParse(input).success).toBe(false);
  });
});
