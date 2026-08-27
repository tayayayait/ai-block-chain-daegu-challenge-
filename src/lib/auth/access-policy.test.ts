import { describe, expect, it } from "vitest";

import { canAccessSubject, type StaffProfile, type SubjectScope } from "./access-policy";

const subject: SubjectScope = {
  id: "subject-1",
  organizationId: "organization-a",
};

const profile = (overrides: Partial<StaffProfile> = {}): StaffProfile => ({
  id: "profile-1",
  organizationId: "organization-a",
  role: "CARE_WORKER",
  ...overrides,
});

describe("subject access policy", () => {
  it("같은 조직 ADMIN은 배정 없이 대상자에 접근할 수 있다", () => {
    expect(canAccessSubject(profile({ role: "ADMIN" }), subject, false)).toBe(true);
  });

  it("다른 조직 ADMIN은 대상자에 접근할 수 없다", () => {
    expect(
      canAccessSubject(profile({ role: "ADMIN", organizationId: "organization-b" }), subject, true),
    ).toBe(false);
  });

  it("같은 조직 CARE_WORKER는 명시적으로 배정된 대상자에만 접근할 수 있다", () => {
    expect(canAccessSubject(profile(), subject, true)).toBe(true);
    expect(canAccessSubject(profile(), subject, false)).toBe(false);
  });

  it("다른 조직 CARE_WORKER는 배정 값과 무관하게 접근할 수 없다", () => {
    expect(canAccessSubject(profile({ organizationId: "organization-b" }), subject, true)).toBe(
      false,
    );
  });
});
