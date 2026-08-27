import { describe, expect, it, vi } from "vitest";

import type { NaverGeocoder } from "@/integrations/naver/geocode.server";

import {
  createSupabaseSubjectRegistrationRepository,
  registerSubject,
  resolveVerifiedAdminActor,
  subjectRegistrationInputSchema,
  type SubjectRegistrationDependencies,
  type SubjectRegistrationRepository,
  type SubjectRegistrationSessionClient,
} from "./subject-registration.server";

const ADMIN_ID = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const SUBJECT_ID = "30000000-0000-4000-8000-000000000001";
const REGISTRATION_REQUEST_ID = "40000000-0000-4000-8000-000000000001";

const rawInput = {
  registrationRequestId: REGISTRATION_REQUEST_ID,
  name: " 김온중 ",
  birthYear: 1941,
  sex: "FEMALE",
  phone: "010-1234-5678",
  guardianPhone: "",
  address: "대구광역시 중구 국채보상로 670",
  livesAlone: true,
  chronicDisease: false,
  hasCooling: true,
  seniorMode: false,
  consent: true,
} as const;

function sessionClient(role: "ADMIN" | "CARE_WORKER" = "ADMIN") {
  const maybeSingle = vi.fn(async () => ({
    data: { id: ADMIN_ID, organization_id: ORGANIZATION_ID, role },
    error: null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getUser = vi.fn<SubjectRegistrationSessionClient["auth"]["getUser"]>(async () => ({
    data: { user: { id: ADMIN_ID } },
    error: null,
  }));
  return {
    client: { auth: { getUser }, from } as unknown as SubjectRegistrationSessionClient,
    getUser,
    from,
    select,
    eq,
    maybeSingle,
  };
}

function dependencies(
  overrides: Partial<SubjectRegistrationDependencies> = {},
): SubjectRegistrationDependencies {
  const repository: SubjectRegistrationRepository = {
    createSubject: vi.fn(async () => SUBJECT_ID),
  };
  const geocoder: NaverGeocoder = {
    search: vi.fn(async () => [
      {
        label: "대구광역시 중구 국채보상로 670",
        roadAddress: "대구광역시 중구 국채보상로 670",
        jibunAddress: "대구광역시 중구 동인동2가 1",
        gu: "중구",
        longitude: 128.601,
        latitude: 35.871,
      },
    ]),
  };
  return {
    resolveActor: vi.fn(async () => ({
      id: ADMIN_ID,
      organizationId: ORGANIZATION_ID,
      role: "ADMIN" as const,
    })),
    geocoder,
    repository,
    computeInitialRisk: vi.fn(async () => undefined),
    now: () => new Date("2026-08-24T08:00:00.000Z"),
    ...overrides,
  };
}

describe("ADMIN subject registration", () => {
  it("passes the browser request id into the atomic registration RPC", async () => {
    const rpc = vi.fn(async () => ({ data: SUBJECT_ID, error: null }));
    const repository = createSupabaseSubjectRegistrationRepository({ rpc });

    await repository.createSubject({
      registrationRequestId: REGISTRATION_REQUEST_ID,
      actorProfileId: ADMIN_ID,
      subject: {
        name: "김온중",
        birthYear: 1941,
        sex: "FEMALE",
        phone: "01012345678",
        guardianPhone: null,
        address: "대구광역시 중구 국채보상로 670",
        longitude: 128.601,
        latitude: 35.871,
        kmaNx: 89,
        kmaNy: 91,
        livesAlone: true,
        chronicDisease: false,
        hasCooling: true,
        seniorMode: false,
        consentedAt: "2026-08-24T08:00:00.000Z",
      },
    });

    expect(rpc).toHaveBeenCalledWith(
      "register_subject_service_role",
      expect.objectContaining({
        p_command: expect.objectContaining({
          registration_request_id: REGISTRATION_REQUEST_ID,
          actor_profile_id: ADMIN_ID,
        }),
      }),
    );
  });

  it("verifies the Supabase user remotely and reloads the ADMIN profile", async () => {
    const fake = sessionClient("ADMIN");

    await expect(resolveVerifiedAdminActor(fake.client)).resolves.toEqual({
      id: ADMIN_ID,
      organizationId: ORGANIZATION_ID,
      role: "ADMIN",
    });
    expect(fake.getUser).toHaveBeenCalledOnce();
    expect(fake.from).toHaveBeenCalledWith("profiles");
    expect(fake.select).toHaveBeenCalledWith("id,organization_id,role");
    expect(fake.eq).toHaveBeenCalledWith("id", ADMIN_ID);
  });

  it("rejects a verified CARE_WORKER profile", async () => {
    const fake = sessionClient("CARE_WORKER");

    await expect(resolveVerifiedAdminActor(fake.client)).rejects.toMatchObject({
      code: "ADMIN_REQUIRED",
    });
  });

  it("fails closed for an invalid or missing Supabase session", async () => {
    const fake = sessionClient();
    fake.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("expired token") });

    await expect(resolveVerifiedAdminActor(fake.client)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("uses only the server geocode, derives the KMA grid, and atomically assigns the creator", async () => {
    const deps = dependencies();

    await expect(registerSubject(rawInput, deps)).resolves.toEqual({
      kind: "success",
      subjectId: SUBJECT_ID,
      canonicalAddress: "대구광역시 중구 국채보상로 670",
      initialRisk: "READY",
    });
    expect(deps.geocoder.search).toHaveBeenCalledWith(rawInput.address);
    expect(deps.repository.createSubject).toHaveBeenCalledWith({
      registrationRequestId: REGISTRATION_REQUEST_ID,
      actorProfileId: ADMIN_ID,
      subject: {
        name: "김온중",
        birthYear: 1941,
        sex: "FEMALE",
        phone: "01012345678",
        guardianPhone: null,
        address: "대구광역시 중구 국채보상로 670",
        longitude: 128.601,
        latitude: 35.871,
        kmaNx: 89,
        kmaNy: 91,
        livesAlone: true,
        chronicDisease: false,
        hasCooling: true,
        seniorMode: false,
        consentedAt: "2026-08-24T08:00:00.000Z",
      },
    });
    expect(deps.computeInitialRisk).toHaveBeenCalledWith(
      SUBJECT_ID,
      new Date("2026-08-24T08:00:00.000Z"),
    );
  });

  it("keeps the saved subject and reports a delayed risk computation when KMA fails", async () => {
    const deps = dependencies({
      computeInitialRisk: vi.fn(async () => {
        throw new Error("provider raw secret should never escape");
      }),
    });

    await expect(registerSubject(rawInput, deps)).resolves.toEqual({
      kind: "success",
      subjectId: SUBJECT_ID,
      canonicalAddress: "대구광역시 중구 국채보상로 670",
      initialRisk: "DELAYED",
    });
  });

  it("rejects ambiguous and non-Daegu addresses without writing PII", async () => {
    const candidate = {
      label: "대구광역시 중구 국채보상로 670",
      roadAddress: "대구광역시 중구 국채보상로 670",
      jibunAddress: "대구광역시 중구 동인동2가 1",
      gu: "중구",
      longitude: 128.601,
      latitude: 35.871,
    };
    const ambiguous = dependencies({
      geocoder: {
        search: vi.fn(async () => [
          candidate,
          { ...candidate, label: "대구광역시 중구 국채보상로 671", longitude: 128.602 },
        ]),
      },
    });
    const unavailable = dependencies({ geocoder: { search: vi.fn(async () => []) } });

    await expect(
      registerSubject({ ...rawInput, address: "대구 중구 국채보상로" }, ambiguous),
    ).resolves.toMatchObject({ kind: "error", code: "ADDRESS_AMBIGUOUS" });
    await expect(registerSubject(rawInput, unavailable)).resolves.toMatchObject({
      kind: "error",
      code: "ADDRESS_NOT_FOUND",
    });
    expect(ambiguous.repository.createSubject).not.toHaveBeenCalled();
    expect(unavailable.repository.createSubject).not.toHaveBeenCalled();
  });

  it("rejects client-selected coordinates, missing consent, and malformed phone values", () => {
    expect(
      subjectRegistrationInputSchema.safeParse({
        ...rawInput,
        latitude: 35.871,
        longitude: 128.601,
      }).success,
    ).toBe(false);
    expect(subjectRegistrationInputSchema.safeParse({ ...rawInput, consent: false }).success).toBe(
      false,
    );
    expect(subjectRegistrationInputSchema.safeParse({ ...rawInput, phone: "123" }).success).toBe(
      false,
    );
    expect(
      subjectRegistrationInputSchema.safeParse({
        ...rawInput,
        address: `대구광역시 ${"가".repeat(121)}`,
      }).success,
    ).toBe(false);
  });
});
