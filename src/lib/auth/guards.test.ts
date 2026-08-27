import { describe, expect, it, vi } from "vitest";

import { createPublicError } from "../error-dto";
import type { StaffProfile, SubjectScope } from "./access-policy";
import {
  createLoginRedirect,
  requireStaffAccess,
  requireSubjectAccess,
  type AuthorizationRepository,
} from "./guards";

const careWorker: StaffProfile = {
  id: "profile-care",
  organizationId: "organization-a",
  role: "CARE_WORKER",
};

const admin: StaffProfile = {
  id: "profile-admin",
  organizationId: "organization-a",
  role: "ADMIN",
};

const subject: SubjectScope = {
  id: "subject-1",
  organizationId: "organization-a",
};

function repository(overrides: Partial<AuthorizationRepository> = {}): AuthorizationRepository {
  return {
    findProfileByUserId: vi.fn(async () => careWorker),
    findSubjectScopeById: vi.fn(async () => subject),
    isSubjectAssignedToProfile: vi.fn(async () => true),
    ...overrides,
  };
}

describe("protected route redirect contract", () => {
  it.each([
    "/dashboard?gu=수성구",
    "/subjects/subject-1",
    "/medication/subject-1?step=capture",
    "/shelters?subjectId=a1000000-0000-4000-8000-000000000001",
  ])("%s를 안전한 내부 next 값으로 보존한다", (nextPath) => {
    expect(createLoginRedirect(nextPath)).toEqual({
      kind: "redirect",
      href: `/login?next=${encodeURIComponent(nextPath)}`,
    });
  });

  it.each(["https://evil.example/steal", "//evil.example/steal", "/report/DG-0001"])(
    "허용되지 않은 next 경로 %s는 대시보드로 제한한다",
    (nextPath) => {
      expect(createLoginRedirect(nextPath)).toEqual({
        kind: "redirect",
        href: "/login?next=%2Fdashboard",
      });
    },
  );
});

describe("staff guard", () => {
  it("비인증 요청은 repository를 호출하지 않고 로그인으로 보낸다", async () => {
    const authRepository = repository();

    await expect(
      requireStaffAccess({ userId: null, nextPath: "/dashboard" }, authRepository),
    ).resolves.toEqual(createLoginRedirect("/dashboard"));
    expect(authRepository.findProfileByUserId).not.toHaveBeenCalled();
  });

  it("인증 사용자에게 DB profile이 없으면 안전한 오류로 접근을 닫는다", async () => {
    const authRepository = repository({ findProfileByUserId: vi.fn(async () => null) });

    await expect(
      requireStaffAccess({ userId: "user-1", nextPath: "/dashboard" }, authRepository),
    ).resolves.toEqual({ kind: "error", error: createPublicError("INTERNAL_ERROR") });
  });

  it("profile 조회가 실패해도 원문을 노출하지 않고 접근을 닫는다", async () => {
    const authRepository = repository({
      findProfileByUserId: vi.fn(async () => {
        throw new Error("DATABASE_URL_WITH_SECRET");
      }),
    });

    const result = await requireStaffAccess(
      { userId: "user-1", nextPath: "/dashboard" },
      authRepository,
    );

    expect(result).toEqual({ kind: "error", error: createPublicError("INTERNAL_ERROR") });
    expect(JSON.stringify(result)).not.toContain("DATABASE_URL_WITH_SECRET");
  });
});

describe("subject guard", () => {
  it("같은 조직 ADMIN은 배정 조회 없이 허용한다", async () => {
    const authRepository = repository({ findProfileByUserId: vi.fn(async () => admin) });

    const result = await requireSubjectAccess(
      { userId: "user-admin", subjectId: "subject-1", nextPath: "/subjects/subject-1" },
      authRepository,
    );

    expect(result).toEqual({ kind: "allow", profile: admin, subject });
    expect(authRepository.isSubjectAssignedToProfile).not.toHaveBeenCalled();
  });

  it("같은 조직 CARE_WORKER는 배정된 대상자만 허용한다", async () => {
    const authRepository = repository();

    await expect(
      requireSubjectAccess(
        { userId: "user-care", subjectId: "subject-1", nextPath: "/subjects/subject-1" },
        authRepository,
      ),
    ).resolves.toEqual({ kind: "allow", profile: careWorker, subject });
    expect(authRepository.isSubjectAssignedToProfile).toHaveBeenCalledWith({
      organizationId: "organization-a",
      profileId: "profile-care",
      subjectId: "subject-1",
    });
  });

  it("미배정 CARE_WORKER는 NOT_FOUND로 거부해 대상자 존재 여부를 숨긴다", async () => {
    const authRepository = repository({
      isSubjectAssignedToProfile: vi.fn(async () => false),
    });

    await expect(
      requireSubjectAccess(
        { userId: "user-care", subjectId: "subject-1", nextPath: "/subjects/subject-1" },
        authRepository,
      ),
    ).resolves.toEqual({ kind: "error", error: createPublicError("NOT_FOUND") });
  });

  it("다른 조직 대상자는 배정 조회 없이 NOT_FOUND로 거부한다", async () => {
    const authRepository = repository({
      findSubjectScopeById: vi.fn(async () => ({
        id: "subject-2",
        organizationId: "organization-b",
      })),
    });

    await expect(
      requireSubjectAccess(
        { userId: "user-care", subjectId: "subject-2", nextPath: "/medication/subject-2" },
        authRepository,
      ),
    ).resolves.toEqual({ kind: "error", error: createPublicError("NOT_FOUND") });
    expect(authRepository.isSubjectAssignedToProfile).not.toHaveBeenCalled();
  });

  it("대상자가 없거나 repository가 실패하면 fail-closed 결과만 반환한다", async () => {
    const missingRepository = repository({ findSubjectScopeById: vi.fn(async () => null) });
    const failingRepository = repository({
      findSubjectScopeById: vi.fn(async () => {
        throw new Error("SUBJECT_PRIVATE_ROW");
      }),
    });
    const input = {
      userId: "user-care",
      subjectId: "subject-missing",
      nextPath: "/subjects/subject-missing",
    };

    await expect(requireSubjectAccess(input, missingRepository)).resolves.toEqual({
      kind: "error",
      error: createPublicError("NOT_FOUND"),
    });

    const failed = await requireSubjectAccess(input, failingRepository);
    expect(failed).toEqual({ kind: "error", error: createPublicError("INTERNAL_ERROR") });
    expect(JSON.stringify(failed)).not.toContain("SUBJECT_PRIVATE_ROW");
  });
});
