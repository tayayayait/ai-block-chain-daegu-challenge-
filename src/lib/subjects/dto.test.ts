import { describe, expect, it } from "vitest";

import {
  maskSubjectName,
  maskSubjectPhone,
  shortenSubjectAddress,
  toMaskedSubjectDto,
  type SubjectPrivateRecord,
} from "./dto";

const subject: SubjectPrivateRecord = {
  id: "subject-1",
  organizationId: "organization-a",
  name: "김온중",
  address: "대구광역시 수성구 범어동 123-45 온중아파트 101동",
  phone: "010-1234-5678",
};

describe("subject PII masking", () => {
  it.each([
    ["김온중", "김○○"],
    ["이수", "이○"],
    ["박", "○"],
    ["  ", "이름 비공개"],
  ])("이름 %j을 첫 글자 외 마스킹한다", (name, expected) => {
    expect(maskSubjectName(name)).toBe(expected);
  });

  it.each([
    ["010-1234-5678", "010-****-5678"],
    ["053-123-4567", "053-***-4567"],
    ["02-1234-5678", "02-****-5678"],
    ["12345", "연락처 비공개"],
    [null, "연락처 비공개"],
  ])("전화번호 %j의 중간 번호를 노출하지 않는다", (phone, expected) => {
    expect(maskSubjectPhone(phone)).toBe(expected);
  });

  it("상세주소는 광역 지자체와 시·군·구까지만 반환한다", () => {
    expect(shortenSubjectAddress(subject.address)).toBe("대구광역시 수성구");
    expect(shortenSubjectAddress("경상북도 경산시 하양읍 대학로 1")).toBe("경상북도 경산시");
  });

  it("행정구역을 확실히 식별하지 못하면 원문 일부도 반환하지 않는다", () => {
    expect(shortenSubjectAddress("범어동 123-45 비밀아파트")).toBe("주소 비공개");
  });

  it("기본 DTO 직렬화에는 이름·상세주소·전체 전화번호 원문이 없다", () => {
    const dto = toMaskedSubjectDto(subject);
    const serialized = JSON.stringify(dto);

    expect(dto).toEqual({
      id: "subject-1",
      maskedName: "김○○",
      shortAddress: "대구광역시 수성구",
      maskedPhone: "010-****-5678",
    });
    expect(Object.keys(dto)).toEqual(["id", "maskedName", "shortAddress", "maskedPhone"]);
    expect(serialized).not.toContain(subject.name);
    expect(serialized).not.toContain("범어동");
    expect(serialized).not.toContain("123-45");
    expect(serialized).not.toContain(subject.phone);
    expect(serialized).not.toContain(subject.organizationId);
  });
});
