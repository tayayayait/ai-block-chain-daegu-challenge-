import { describe, expect, it } from "vitest";

import { AlertDetailDtoSchema } from "./detail";

const valid = {
  eventId: "123e4567-e89b-42d3-a456-426614174001",
  maskedName: "김○○",
  riskLevel: "L4",
  hri: 82,
  occurredAt: "2026-08-23T12:00:00.000Z",
  reasons: ["체감온도가 매우 높습니다", "열 관련 주의가 필요한 복약 정보가 있습니다"],
  demo: true,
} as const;

describe("public guardian alert detail DTO", () => {
  it("accepts only the minimal masked alert payload", () => {
    expect(AlertDetailDtoSchema.parse(valid)).toEqual(valid);
  });

  it("caps reasons at three and rejects accidental PII fields", () => {
    expect(
      AlertDetailDtoSchema.safeParse({
        ...valid,
        reasons: [...valid.reasons, "세 번째", "네 번째"],
      }).success,
    ).toBe(false);
    expect(
      AlertDetailDtoSchema.safeParse({ ...valid, phone: "010-1234-5678", address: "상세주소" })
        .success,
    ).toBe(false);
  });
});
