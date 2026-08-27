import { describe, expect, it } from "vitest";

import {
  PublicShelterDtoSchema,
  ShelterReportTargetDtoSchema,
  toPublicShelterDto,
  toShelterReportTargetDto,
} from "./public-dto";

const rpcRow = {
  shelter_id: "DG-0009",
  shelter_name: "DGB대구은행 중구청지점",
  facility_type: "금융기관",
  gu: "중구",
  is_im_bank: true,
  road_address: "대구광역시 중구 국채보상로139길 1",
  latitude: 35.8707,
  longitude: 128.6063,
  distance_m: 312.4,
  walk_minutes: 7,
  operating_state: "OPEN",
  crowd_level: 0,
  report_observed_at: "2026-08-23T12:30:00.000Z",
  attestation_state: "VERIFIED",
  attestation_uid: "0xabc",
  reporter_hash: "must-not-leak",
  kma_nx: 89,
  source_geo_idn: "9",
};

describe("public shelter DTO", () => {
  it("creates a strict minimal report-target DTO without status internals", () => {
    const target = toShelterReportTargetDto(rpcRow);

    expect(target).toEqual({
      id: "DG-0009",
      name: "DGB대구은행 중구청지점",
      facilityType: "금융기관",
      gu: "중구",
      isImBank: true,
      roadAddress: "대구광역시 중구 국채보상로139길 1",
      latitude: 35.8707,
      longitude: 128.6063,
    });
    expect(
      ShelterReportTargetDtoSchema.safeParse({ ...target, reporterHash: "forbidden" }).success,
    ).toBe(false);
  });

  it("maps only the public shelter, coordinate, address, distance and status allowlist", () => {
    expect(toPublicShelterDto(rpcRow)).toEqual({
      id: "DG-0009",
      name: "DGB대구은행 중구청지점",
      facilityType: "금융기관",
      gu: "중구",
      isImBank: true,
      roadAddress: "대구광역시 중구 국채보상로139길 1",
      latitude: 35.8707,
      longitude: 128.6063,
      distanceM: 312,
      walkMin: 7,
      open: "OPEN",
      crowd: "SPARSE",
      lastReportAt: "2026-08-23T12:30:00.000Z",
      attest: "VERIFIED",
      attestUid: "0xabc",
    });

    expect(JSON.stringify(toPublicShelterDto(rpcRow))).not.toMatch(
      /reporter_hash|kma_nx|source_geo_idn|must-not-leak/,
    );
  });

  it("preserves unknown and missing optional status without inventing crowd data", () => {
    expect(
      toPublicShelterDto({
        ...rpcRow,
        operating_state: "UNKNOWN",
        crowd_level: null,
        report_observed_at: null,
        attestation_state: null,
        attestation_uid: null,
      }),
    ).toMatchObject({
      open: "UNKNOWN",
      lastReportAt: null,
      attest: "UNVERIFIED",
    });
    expect(
      "crowd" in
        toPublicShelterDto({
          ...rpcRow,
          operating_state: "UNKNOWN",
          crowd_level: null,
          report_observed_at: null,
          attestation_state: null,
          attestation_uid: null,
        }),
    ).toBe(false);
  });

  it("rejects unknown fields at the final DTO boundary", () => {
    const result = PublicShelterDtoSchema.safeParse({
      ...toPublicShelterDto(rpcRow),
      reporterHash: "forbidden",
    });

    expect(result.success).toBe(false);
  });
});
