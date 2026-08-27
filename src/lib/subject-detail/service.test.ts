import { describe, expect, it, vi } from "vitest";

import type { SubjectGuardResult } from "@/lib/auth/guards";
import type { SubjectPrivateRecord } from "@/lib/subjects/dto";

import {
  getSubjectDetail,
  type SubjectDetailAccessAuthorizer,
  type SubjectDetailRecord,
  type SubjectDetailRepository,
} from "./service.server";

const privateSubject: SubjectPrivateRecord = {
  id: "subject-1",
  organizationId: "organization-1",
  name: "김온중",
  address: "대구광역시 수성구 파동로3길 62",
  phone: "010-1234-5678",
};

const allow: SubjectGuardResult = {
  kind: "allow",
  profile: { id: "profile-1", organizationId: "organization-1", role: "CARE_WORKER" },
  subject: { id: "subject-1", organizationId: "organization-1" },
};

const baseRecord: SubjectDetailRecord = {
  subject: {
    ...privateSubject,
    birthYear: 1944,
    sex: "FEMALE",
    livesAlone: true,
    seniorMode: true,
    medicationProfileRegisteredAt: "2026-08-01T00:00:00.000Z",
  },
  latestRisk: {
    score: 70,
    level: "L3",
    breakdown: { E: 47, M: 12, P: 17, C: 6 },
    reasons: ["폭염경보가 발효 중입니다."],
    computedAt: "2026-08-23T05:03:00.000Z",
  },
  medications: [
    {
      id: "med-1",
      productName: "라식스정 40mg",
      heatClass: "이뇨제",
      riskTier: "HIGH",
      source: "AI_AUTO",
      confidence: 0.91,
      createdAt: "2026-08-22T00:00:00.000Z",
    },
  ],
  careEvents: [
    {
      id: "event-1",
      type: "ALERT_SENT",
      riskLevel: "L3",
      hri: 70,
      occurredAt: "2026-08-23T05:03:00.000Z",
      attestationState: "VERIFIED",
      attestationUid: "0xabc",
      issuer: "demo-issuer",
    },
  ],
};

function authorizer(result: SubjectGuardResult = allow): SubjectDetailAccessAuthorizer {
  return vi.fn(async () => result);
}

function repository(record: SubjectDetailRecord | null = baseRecord): SubjectDetailRepository {
  return { findSubjectDetailById: vi.fn(async () => record) };
}

describe("subject detail use case", () => {
  it("returns a masked, scope-checked detail DTO with an arithmetically valid risk", async () => {
    const result = await getSubjectDetail(
      {
        userId: "user-1",
        subjectId: "subject-1",
        nextPath: "/subjects/subject-1",
      },
      { authorizeSubject: authorizer(), repository: repository(), now: new Date("2026-08-23") },
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.data.subject).toEqual({
      id: "subject-1",
      maskedName: "김○○",
      shortAddress: "대구광역시 수성구",
      maskedPhone: "010-****-5678",
      age: 82,
      sex: "FEMALE",
      livesAlone: true,
      seniorMode: true,
      medicationRegistered: true,
    });
    expect(JSON.stringify(result.data)).not.toContain("김온중");
    expect(JSON.stringify(result.data)).not.toContain("파동로3길");
    expect(JSON.stringify(result.data)).not.toContain("010-1234-5678");
    expect(result.data.latestRisk?.score).toBe(70);
  });

  it("does not call the repository when authorization is denied", async () => {
    const denied: SubjectGuardResult = {
      kind: "error",
      error: {
        code: "NOT_FOUND",
        userMessage: "요청한 정보를 찾을 수 없습니다. 주소를 확인해 주세요.",
        retryable: false,
      },
    };
    const detailRepository = repository();

    await expect(
      getSubjectDetail(
        { userId: "user-2", subjectId: "subject-1", nextPath: "/subjects/subject-1" },
        { authorizeSubject: authorizer(denied), repository: detailRepository },
      ),
    ).resolves.toEqual(denied);
    expect(detailRepository.findSubjectDetailById).not.toHaveBeenCalled();
  });

  it("fails closed for organization mismatch, invalid HRI math, and repository exceptions", async () => {
    const wrongScope: SubjectDetailRecord = {
      ...baseRecord,
      subject: { ...baseRecord.subject, organizationId: "organization-2" },
    };
    const badMath: SubjectDetailRecord = {
      ...baseRecord,
      latestRisk: { ...baseRecord.latestRisk!, score: 99 },
    };
    const throwingRepository: SubjectDetailRepository = {
      findSubjectDetailById: vi.fn(async () => {
        throw new Error("private database detail");
      }),
    };

    for (const detailRepository of [
      repository(wrongScope),
      repository(badMath),
      throwingRepository,
    ]) {
      const result = await getSubjectDetail(
        { userId: "user-1", subjectId: "subject-1", nextPath: "/subjects/subject-1" },
        { authorizeSubject: authorizer(), repository: detailRepository },
      );
      expect(result).toEqual({
        kind: "error",
        error: {
          code: "INTERNAL_ERROR",
          userMessage: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          retryable: true,
        },
      });
      expect(JSON.stringify(result)).not.toMatch(/김온중|파동로3길|private database detail/);
    }
  });

  it("supports a registered empty medication history and a pending first risk snapshot", async () => {
    const pending: SubjectDetailRecord = {
      ...baseRecord,
      latestRisk: null,
      medications: [],
      careEvents: [],
    };
    const result = await getSubjectDetail(
      { userId: "user-1", subjectId: "subject-1", nextPath: "/subjects/subject-1" },
      { authorizeSubject: authorizer(), repository: repository(pending) },
    );

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.data.subject.medicationRegistered).toBe(true);
      expect(result.data.latestRisk).toBeNull();
      expect(result.data.medications).toEqual([]);
      expect(result.data.careEvents).toEqual([]);
    }
  });
});
