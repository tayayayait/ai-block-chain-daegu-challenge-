import { describe, expect, it } from "vitest";

import type { AttestState } from "@/lib/domain-types";
import { hasVerifiedShelterCheckInWithin24h } from "./check-in";

const computedAt = new Date("2026-08-23T14:00:00+09:00");

describe("verified shelter check-in mitigation eligibility", () => {
  it.each([
    ["VERIFIED", "2026-08-23T13:59:59+09:00", true],
    ["VERIFIED", "2026-08-22T14:00:00+09:00", true],
    ["VERIFIED", "2026-08-22T13:59:59.999+09:00", false],
    ["UNVERIFIED", "2026-08-23T13:00:00+09:00", false],
    ["PENDING", "2026-08-23T13:00:00+09:00", false],
    ["FAILED", "2026-08-23T13:00:00+09:00", false],
    ["VERIFIED", "2026-08-23T14:00:00.001+09:00", false],
  ] satisfies ReadonlyArray<readonly [AttestState, string, boolean]>)(
    "%s 체크인이 %s이면 완화 적용 여부는 %s이다",
    (attestationState, checkedInAt, expected) => {
      expect(
        hasVerifiedShelterCheckInWithin24h(
          [{ attestationState, checkedInAt: new Date(checkedInAt) }],
          computedAt,
        ),
      ).toBe(expected);
    },
  );

  it("여러 기록 중 조건을 만족하는 체크인이 하나라도 있으면 적용한다", () => {
    expect(
      hasVerifiedShelterCheckInWithin24h(
        [
          { attestationState: "FAILED", checkedInAt: new Date("2026-08-23T13:30:00+09:00") },
          { attestationState: "VERIFIED", checkedInAt: new Date("2026-08-23T12:00:00+09:00") },
        ],
        computedAt,
      ),
    ).toBe(true);
  });

  it("유효하지 않은 시각은 완화 근거로 사용하지 않는다", () => {
    expect(
      hasVerifiedShelterCheckInWithin24h(
        [{ attestationState: "VERIFIED", checkedInAt: new Date(Number.NaN) }],
        computedAt,
      ),
    ).toBe(false);
  });
});
