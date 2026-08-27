import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCookies, setCookie, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { createDefaultKmaClient } from "@/integrations/kma/kma.server";
import type { NaverAddressCandidate, NaverGeocoder } from "@/integrations/naver/geocode.server";
import { createNaverGeocoder } from "@/integrations/naver/geocode.server";
import { createWeatherRepository } from "@/integrations/kma/weather-repository.server";
import { createWeatherService } from "@/integrations/kma/weather-service.server";
import { getServerEnv } from "@/lib/env.server";
import { toKmaGrid } from "@/lib/geo/kma-grid";
import { recomputeRiskSubject } from "@/lib/risk/recompute-risk";
import { createSupabaseRiskBatchRepository } from "@/lib/risk/supabase-risk-repository.server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";
import { createSessionSupabaseClient } from "@/lib/supabase/session.server";

import {
  subjectRegistrationInputSchema,
  type ParsedSubjectRegistrationInput,
  type SubjectRegistrationErrorCode,
  type SubjectRegistrationInput,
  type SubjectRegistrationResult,
} from "./subject-registration.schema";

export {
  subjectRegistrationInputSchema,
  type SubjectRegistrationErrorCode,
  type SubjectRegistrationInput,
  type SubjectRegistrationResult,
} from "./subject-registration.schema";

const UuidSchema = z.string().uuid();

const AdminActorSchema = z
  .object({
    id: UuidSchema,
    organization_id: UuidSchema,
    role: z.enum(["ADMIN", "CARE_WORKER"]),
  })
  .strict();

export type SubjectRegistrationActor = Readonly<{
  id: string;
  organizationId: string;
  role: "ADMIN";
}>;

export class SubjectRegistrationError extends Error {
  constructor(readonly code: SubjectRegistrationErrorCode) {
    super(code);
    this.name = "SubjectRegistrationError";
  }
}

export type SubjectRegistrationCommand = Readonly<{
  registrationRequestId: string;
  actorProfileId: string;
  subject: Readonly<{
    name: string;
    birthYear: number;
    sex: "FEMALE" | "MALE" | "OTHER" | "UNDISCLOSED";
    phone: string | null;
    guardianPhone: string | null;
    address: string;
    longitude: number;
    latitude: number;
    kmaNx: number;
    kmaNy: number;
    livesAlone: boolean;
    chronicDisease: boolean;
    hasCooling: boolean;
    seniorMode: boolean;
    consentedAt: string;
  }>;
}>;

export interface SubjectRegistrationRepository {
  createSubject(command: SubjectRegistrationCommand): Promise<string>;
}

export interface SubjectRegistrationDependencies {
  resolveActor(): Promise<SubjectRegistrationActor>;
  geocoder: NaverGeocoder;
  repository: SubjectRegistrationRepository;
  computeInitialRisk(subjectId: string, computedAt: Date): Promise<void>;
  now(): Date;
}

type QueryResult = PromiseLike<{ data: unknown; error: unknown }>;
type ProfileQuery = {
  eq(column: string, value: string): { maybeSingle(): QueryResult };
};

export type SubjectRegistrationSessionClient = Readonly<{
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
  from(table: string): {
    select(columns: string): ProfileQuery;
  };
}>;

const ERROR_MESSAGES: Readonly<Record<SubjectRegistrationErrorCode, string>> = {
  AUTH_REQUIRED: "로그인이 만료되었습니다. 다시 로그인해 주세요.",
  ADMIN_REQUIRED: "대상자 등록은 관리자만 할 수 있습니다.",
  INVALID_INPUT: "입력 내용을 확인해 주세요.",
  ADDRESS_NOT_FOUND: "대구광역시 주소를 확인할 수 없습니다.",
  ADDRESS_AMBIGUOUS: "주소를 도로명과 건물번호까지 더 구체적으로 입력해 주세요.",
  ADDRESS_LOOKUP_UNAVAILABLE: "주소 확인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
  SAVE_FAILED: "대상자를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

function errorResult(code: SubjectRegistrationErrorCode): SubjectRegistrationResult {
  return { kind: "error", code, userMessage: ERROR_MESSAGES[code] };
}

/** Supabase Auth and the current profile row are both re-read for every privileged request. */
export async function resolveVerifiedAdminActor(
  client: SubjectRegistrationSessionClient,
): Promise<SubjectRegistrationActor> {
  let userId: string;
  try {
    const result = await client.auth.getUser();
    if (result.error || !result.data.user) throw new SubjectRegistrationError("AUTH_REQUIRED");
    userId = UuidSchema.parse(result.data.user.id);
  } catch (error) {
    if (error instanceof SubjectRegistrationError) throw error;
    throw new SubjectRegistrationError("AUTH_REQUIRED");
  }

  let profile: z.infer<typeof AdminActorSchema>;
  try {
    const result = await client
      .from("profiles")
      .select("id,organization_id,role")
      .eq("id", userId)
      .maybeSingle();
    if (result.error || result.data === null) {
      throw new SubjectRegistrationError("ADMIN_REQUIRED");
    }
    profile = AdminActorSchema.parse(result.data);
  } catch (error) {
    if (error instanceof SubjectRegistrationError) throw error;
    throw new SubjectRegistrationError("ADMIN_REQUIRED");
  }

  if (profile.id !== userId || profile.role !== "ADMIN") {
    throw new SubjectRegistrationError("ADMIN_REQUIRED");
  }
  return { id: profile.id, organizationId: profile.organization_id, role: "ADMIN" };
}

function normalizedAddress(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").replace(/[(),]/gu, "");
}

function resolvedCandidate(
  query: string,
  candidates: readonly NaverAddressCandidate[],
): NaverAddressCandidate | SubjectRegistrationErrorCode {
  const valid = candidates.filter(
    (candidate) =>
      Number.isFinite(candidate.longitude) &&
      Number.isFinite(candidate.latitude) &&
      candidate.longitude >= 128.2 &&
      candidate.longitude <= 129.2 &&
      candidate.latitude >= 35.4 &&
      candidate.latitude <= 36.3 &&
      (candidate.roadAddress.startsWith("대구광역시 ") ||
        candidate.jibunAddress.startsWith("대구광역시 ")),
  );
  if (valid.length === 0) return "ADDRESS_NOT_FOUND";
  if (valid.length === 1) return valid[0]!;

  const normalizedQuery = normalizedAddress(query);
  const exact = valid.filter((candidate) =>
    [candidate.label, candidate.roadAddress, candidate.jibunAddress].some(
      (address) => address && normalizedAddress(address) === normalizedQuery,
    ),
  );
  return exact.length === 1 ? exact[0]! : "ADDRESS_AMBIGUOUS";
}

function validNow(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new SubjectRegistrationError("SAVE_FAILED");
  return new Date(now.getTime());
}

export async function registerSubject(
  rawInput: SubjectRegistrationInput,
  dependencies: SubjectRegistrationDependencies,
): Promise<SubjectRegistrationResult> {
  let actor: SubjectRegistrationActor;
  try {
    actor = await dependencies.resolveActor();
    if (actor.role !== "ADMIN") return errorResult("ADMIN_REQUIRED");
  } catch (error) {
    return errorResult(error instanceof SubjectRegistrationError ? error.code : "AUTH_REQUIRED");
  }

  const parsed = subjectRegistrationInputSchema.safeParse(rawInput);
  if (!parsed.success) return errorResult("INVALID_INPUT");
  const input: ParsedSubjectRegistrationInput = parsed.data;

  let candidates: readonly NaverAddressCandidate[];
  try {
    candidates = await dependencies.geocoder.search(input.address);
  } catch {
    return errorResult("ADDRESS_LOOKUP_UNAVAILABLE");
  }
  const candidate = resolvedCandidate(input.address, candidates);
  if (typeof candidate === "string") return errorResult(candidate);

  const now = validNow(dependencies.now());
  const kma = toKmaGrid(candidate.latitude, candidate.longitude);
  const canonicalAddress = candidate.roadAddress || candidate.jibunAddress;
  let subjectId: string;
  try {
    subjectId = UuidSchema.parse(
      await dependencies.repository.createSubject({
        registrationRequestId: input.registrationRequestId,
        actorProfileId: actor.id,
        subject: {
          name: input.name,
          birthYear: input.birthYear,
          sex: input.sex,
          phone: input.phone,
          guardianPhone: input.guardianPhone,
          address: canonicalAddress,
          longitude: candidate.longitude,
          latitude: candidate.latitude,
          kmaNx: kma.nx,
          kmaNy: kma.ny,
          livesAlone: input.livesAlone,
          chronicDisease: input.chronicDisease,
          hasCooling: input.hasCooling,
          seniorMode: input.seniorMode,
          consentedAt: now.toISOString(),
        },
      }),
    );
  } catch {
    return errorResult("SAVE_FAILED");
  }

  try {
    await dependencies.computeInitialRisk(subjectId, now);
    return { kind: "success", subjectId, canonicalAddress, initialRisk: "READY" };
  } catch {
    return { kind: "success", subjectId, canonicalAddress, initialRisk: "DELAYED" };
  }
}

export function createSupabaseSubjectRegistrationRepository(
  client: Readonly<{
    rpc(
      functionName: string,
      arguments_: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  }>,
): SubjectRegistrationRepository {
  return {
    async createSubject(command) {
      const result = await client.rpc("register_subject_service_role", {
        p_command: {
          registration_request_id: UuidSchema.parse(command.registrationRequestId),
          actor_profile_id: UuidSchema.parse(command.actorProfileId),
          subject: {
            name: command.subject.name,
            birth_year: command.subject.birthYear,
            sex: command.subject.sex,
            phone: command.subject.phone,
            guardian_phone: command.subject.guardianPhone,
            address: command.subject.address,
            longitude: command.subject.longitude,
            latitude: command.subject.latitude,
            kma_nx: command.subject.kmaNx,
            kma_ny: command.subject.kmaNy,
            lives_alone: command.subject.livesAlone,
            chronic_disease: command.subject.chronicDisease,
            has_cooling: command.subject.hasCooling,
            senior_mode: command.subject.seniorMode,
            consented_at: command.subject.consentedAt,
          },
        },
      });
      if (result.error) throw new SubjectRegistrationError("SAVE_FAILED");
      return UuidSchema.parse(result.data);
    },
  };
}

function setPrivateNoStoreHeaders(): void {
  setResponseHeader("cache-control", "private, no-cache, no-store, must-revalidate, max-age=0");
  setResponseHeader("expires", "0");
  setResponseHeader("pragma", "no-cache");
}

function createRequestClient() {
  return createSessionSupabaseClient({
    getAll: () =>
      Object.entries(getCookies()).map(([name, value]) => ({
        name,
        value,
      })),
    setAll: (cookiesToSet) => {
      for (const { name, value, options } of cookiesToSet) setCookie(name, value, options);
    },
  });
}

async function computeProductionInitialRisk(
  client: SupabaseClient,
  subjectId: string,
  computedAt: Date,
): Promise<void> {
  const weatherService = createWeatherService({
    kmaClient: createDefaultKmaClient(),
    repository: createWeatherRepository(client),
    clock: { now: () => computedAt },
  });
  const repository = createSupabaseRiskBatchRepository({
    client,
    weatherResolver: weatherService,
  });
  await recomputeRiskSubject({ subjectId, computedAt, repository });
}

export async function readSubjectRegistrationAccessForRequest(): Promise<
  Readonly<{ kind: "allow" }> | Extract<SubjectRegistrationResult, { kind: "error" }>
> {
  setPrivateNoStoreHeaders();
  try {
    await resolveVerifiedAdminActor(
      createRequestClient() as unknown as SubjectRegistrationSessionClient,
    );
    return { kind: "allow" };
  } catch (error) {
    return errorResult(
      error instanceof SubjectRegistrationError ? error.code : "AUTH_REQUIRED",
    ) as Extract<SubjectRegistrationResult, { kind: "error" }>;
  }
}

export async function registerSubjectForRequest(
  input: SubjectRegistrationInput,
): Promise<SubjectRegistrationResult> {
  setPrivateNoStoreHeaders();
  const sessionClient = createRequestClient();
  const adminClient = createAdminSupabaseClient();
  const environment = getServerEnv();
  return registerSubject(input, {
    resolveActor: () =>
      resolveVerifiedAdminActor(sessionClient as unknown as SubjectRegistrationSessionClient),
    geocoder: createNaverGeocoder({
      clientId: environment.NAVER_MAPS_CLIENT_ID,
      clientSecret: environment.NAVER_MAPS_CLIENT_SECRET,
    }),
    repository: createSupabaseSubjectRegistrationRepository(
      adminClient as unknown as Parameters<typeof createSupabaseSubjectRegistrationRepository>[0],
    ),
    computeInitialRisk: (subjectId, computedAt) =>
      computeProductionInitialRisk(adminClient, subjectId, computedAt),
    now: () => new Date(),
  });
}
