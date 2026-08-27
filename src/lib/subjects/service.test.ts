import { describe, expect, it, vi } from "vitest";

import { createPublicError } from "../error-dto";
import type { StaffProfile, SubjectScope } from "../auth/access-policy";
import type { SubjectGuardResult } from "../auth/guards";
import type { SubjectPrivateRecord } from "./dto";
import {
  getFullSubjectPii,
  getMaskedSubject,
  type FullPiiAuthorizer,
  type SubjectAccessAuthorizer,
  type SubjectRepository,
} from "./service.server";

const profile: StaffProfile = {
  id: "profile-care",
  organizationId: "organization-a",
  role: "CARE_WORKER",
};

const subjectScope: SubjectScope = {
  id: "subject-1",
  organizationId: "organization-a",
};

const privateSubject: SubjectPrivateRecord = {
  id: "subject-1",
  organizationId: "organization-a",
  name: "김온중",
  address: "대구광역시 수성구 범어동 123-45 온중아파트 101동",
  phone: "010-1234-5678",
};

const allow: SubjectGuardResult = {
  kind: "allow",
  profile,
  subject: subjectScope,
};

const input = {
  userId: "user-care",
  subjectId: "subject-1",
  nextPath: "/subjects/subject-1",
} as const;

function authorizer(result: SubjectGuardResult = allow): SubjectAccessAuthorizer {
  return vi.fn(async () => result);
}

function repository(record: SubjectPrivateRecord | null = privateSubject): SubjectRepository {
  return {
    findPrivateSubjectById: vi.fn(async () => record),
  };
}

describe("masked subject use case", () => {
  it("권한 확인 뒤 기본 마스킹 DTO만 반환한다", async () => {
    const subjectRepository = repository();

    const result = await getMaskedSubject(input, {
      authorizeSubject: authorizer(),
      repository: subjectRepository,
    });

    expect(result).toEqual({
      kind: "success",
      data: {
        id: "subject-1",
        maskedName: "김○○",
        shortAddress: "대구광역시 수성구",
        maskedPhone: "010-****-5678",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/김온중|범어동|123-45|010-1234-5678/);
  });

  it("가드가 거부하면 private repository를 호출하지 않고 결과를 그대로 전달한다", async () => {
    const denied = { kind: "error", error: createPublicError("NOT_FOUND") } as const;
    const subjectRepository = repository();

    await expect(
      getMaskedSubject(input, {
        authorizeSubject: authorizer(denied),
        repository: subjectRepository,
      }),
    ).resolves.toEqual(denied);
    expect(subjectRepository.findPrivateSubjectById).not.toHaveBeenCalled();
  });
});

describe("full subject PII use case", () => {
  it("대상자 가드와 별도 PII 승인을 순서대로 통과한 뒤에만 원문 DTO를 반환한다", async () => {
    const calls: string[] = [];
    const authorizeSubject: SubjectAccessAuthorizer = async () => {
      calls.push("subject-access");
      return allow;
    };
    const authorizeFullPii: FullPiiAuthorizer = async ({ purpose }) => {
      calls.push(`full-pii:${purpose}`);
      return true;
    };
    const subjectRepository: SubjectRepository = {
      findPrivateSubjectById: async () => {
        calls.push("private-read");
        return privateSubject;
      },
    };

    const result = await getFullSubjectPii(
      { ...input, purpose: "CARE_COORDINATION" },
      { authorizeSubject, authorizeFullPii, repository: subjectRepository },
    );

    expect(calls).toEqual(["subject-access", "full-pii:CARE_COORDINATION", "private-read"]);
    expect(result).toEqual({
      kind: "success",
      data: {
        id: "subject-1",
        name: "김온중",
        address: "대구광역시 수성구 범어동 123-45 온중아파트 101동",
        phone: "010-1234-5678",
      },
    });
    expect(Object.keys(result.kind === "success" ? result.data : {})).toEqual([
      "id",
      "name",
      "address",
      "phone",
    ]);
  });

  it("별도 PII 승인이 거부되면 private repository를 절대 조회하지 않는다", async () => {
    const subjectRepository = repository();
    const authorizeFullPii = vi.fn(async () => false);

    const result = await getFullSubjectPii(
      { ...input, purpose: "MEDICATION_REVIEW" },
      {
        authorizeSubject: authorizer(),
        authorizeFullPii,
        repository: subjectRepository,
      },
    );

    expect(result).toEqual({ kind: "error", error: createPublicError("NOT_FOUND") });
    expect(authorizeFullPii).toHaveBeenCalledWith({
      profile,
      subject: subjectScope,
      purpose: "MEDICATION_REVIEW",
    });
    expect(subjectRepository.findPrivateSubjectById).not.toHaveBeenCalled();
  });

  it("대상자 가드가 거부되면 PII 승인과 private repository를 모두 호출하지 않는다", async () => {
    const redirect = { kind: "redirect", href: "/login?next=%2Fsubjects%2Fsubject-1" } as const;
    const authorizeFullPii = vi.fn<FullPiiAuthorizer>(async () => true);
    const subjectRepository = repository();

    await expect(
      getFullSubjectPii(
        { ...input, userId: null, purpose: "CARE_COORDINATION" },
        {
          authorizeSubject: authorizer(redirect),
          authorizeFullPii,
          repository: subjectRepository,
        },
      ),
    ).resolves.toEqual(redirect);
    expect(authorizeFullPii).not.toHaveBeenCalled();
    expect(subjectRepository.findPrivateSubjectById).not.toHaveBeenCalled();
  });

  it("PII 승인 또는 repository 예외는 원문 없는 INTERNAL_ERROR로 닫는다", async () => {
    const failingPii: FullPiiAuthorizer = async () => {
      throw new Error("PII_POLICY_PRIVATE_REASON");
    };
    const failingRepository: SubjectRepository = {
      findPrivateSubjectById: async () => {
        throw new Error("PRIVATE_DATABASE_ROW");
      },
    };

    const permissionFailure = await getFullSubjectPii(
      { ...input, purpose: "EMERGENCY_RESPONSE" },
      {
        authorizeSubject: authorizer(),
        authorizeFullPii: failingPii,
        repository: repository(),
      },
    );
    const repositoryFailure = await getFullSubjectPii(
      { ...input, purpose: "EMERGENCY_RESPONSE" },
      {
        authorizeSubject: authorizer(),
        authorizeFullPii: async () => true,
        repository: failingRepository,
      },
    );

    expect(permissionFailure).toEqual({
      kind: "error",
      error: createPublicError("INTERNAL_ERROR"),
    });
    expect(repositoryFailure).toEqual({
      kind: "error",
      error: createPublicError("INTERNAL_ERROR"),
    });
    expect(JSON.stringify([permissionFailure, repositoryFailure])).not.toMatch(
      /PII_POLICY_PRIVATE_REASON|PRIVATE_DATABASE_ROW/,
    );
  });

  it("repository 행의 대상자나 조직 범위가 승인 결과와 다르면 PII를 반환하지 않는다", async () => {
    const mismatched = {
      ...privateSubject,
      id: "subject-2",
      organizationId: "organization-b",
    };

    await expect(
      getFullSubjectPii(
        { ...input, purpose: "CARE_COORDINATION" },
        {
          authorizeSubject: authorizer(),
          authorizeFullPii: async () => true,
          repository: repository(mismatched),
        },
      ),
    ).resolves.toEqual({ kind: "error", error: createPublicError("NOT_FOUND") });
  });
});
