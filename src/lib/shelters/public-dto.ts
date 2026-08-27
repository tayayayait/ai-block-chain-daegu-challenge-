import { z } from "zod";

import { ATTEST_STATES, CROWD_LEVELS, SHELTER_OPEN_STATES } from "@/lib/domain-types";
import { DAEGU_GU } from "./search-schema";

const FacilityTypeSchema = z.enum(["경로당", "금융기관", "행정복지센터", "기타"]);
export const ShelterIdSchema = z.string().regex(/^DG-\d{4}$/);

export const ShelterReportTargetDtoSchema = z
  .object({
    id: ShelterIdSchema,
    name: z.string().trim().min(1),
    facilityType: FacilityTypeSchema,
    gu: z.enum(DAEGU_GU),
    isImBank: z.boolean(),
    roadAddress: z.string().trim().min(1),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

export type ShelterReportTargetDto = z.infer<typeof ShelterReportTargetDtoSchema>;

const ShelterIdentityRpcRowSchema = z
  .object({
    shelter_id: ShelterIdSchema,
    shelter_name: z.string().trim().min(1),
    facility_type: FacilityTypeSchema,
    gu: z.enum(DAEGU_GU),
    is_im_bank: z.boolean(),
    road_address: z.string().trim().min(1),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .passthrough();

export const PublicShelterDtoSchema = z
  .object({
    id: ShelterIdSchema,
    name: z.string().trim().min(1),
    facilityType: FacilityTypeSchema,
    gu: z.enum(DAEGU_GU),
    isImBank: z.boolean(),
    roadAddress: z.string().trim().min(1),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    distanceM: z.number().int().nonnegative(),
    walkMin: z.number().int().nonnegative(),
    open: z.enum(SHELTER_OPEN_STATES),
    crowd: z.enum(CROWD_LEVELS).optional(),
    lastReportAt: z.string().datetime({ offset: true }).nullable(),
    attest: z.enum(ATTEST_STATES),
    attestUid: z.string().trim().min(1).optional(),
  })
  .strict();

export type PublicShelterDto = z.infer<typeof PublicShelterDtoSchema>;

const ShelterSearchRpcRowSchema = z
  .object({
    shelter_id: ShelterIdSchema,
    shelter_name: z.string().trim().min(1),
    facility_type: FacilityTypeSchema,
    gu: z.enum(DAEGU_GU),
    is_im_bank: z.boolean(),
    road_address: z.string().trim().min(1),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    distance_m: z.number().finite().nonnegative(),
    walk_minutes: z.number().int().nonnegative(),
    operating_state: z.enum(SHELTER_OPEN_STATES),
    crowd_level: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
    report_observed_at: z.string().datetime({ offset: true }).nullable(),
    attestation_state: z.enum(ATTEST_STATES).nullable(),
    attestation_uid: z.string().trim().min(1).nullable(),
  })
  .passthrough();

const CROWD_BY_DB_VALUE = {
  0: "SPARSE",
  1: "MODERATE",
  2: "CROWDED",
} as const;

export function toShelterReportTargetDto(input: unknown): ShelterReportTargetDto {
  const row = ShelterIdentityRpcRowSchema.parse(input);
  return ShelterReportTargetDtoSchema.parse({
    id: row.shelter_id,
    name: row.shelter_name,
    facilityType: row.facility_type,
    gu: row.gu,
    isImBank: row.is_im_bank,
    roadAddress: row.road_address,
    latitude: row.latitude,
    longitude: row.longitude,
  });
}

export function toPublicShelterDto(input: unknown): PublicShelterDto {
  const row = ShelterSearchRpcRowSchema.parse(input);
  const dto = {
    id: row.shelter_id,
    name: row.shelter_name,
    facilityType: row.facility_type,
    gu: row.gu,
    isImBank: row.is_im_bank,
    roadAddress: row.road_address,
    latitude: row.latitude,
    longitude: row.longitude,
    distanceM: Math.round(row.distance_m),
    walkMin: row.walk_minutes,
    open: row.operating_state,
    ...(row.crowd_level === null ? {} : { crowd: CROWD_BY_DB_VALUE[row.crowd_level] }),
    lastReportAt: row.report_observed_at,
    attest: row.attestation_state ?? "UNVERIFIED",
    ...(row.attestation_uid === null ? {} : { attestUid: row.attestation_uid }),
  };

  return PublicShelterDtoSchema.parse(dto);
}
