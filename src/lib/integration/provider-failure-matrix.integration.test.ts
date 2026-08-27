import { describe, expect, it, vi } from "vitest";

import { createKmaClient } from "@/integrations/kma/kma.server";
import {
  createVillageFallbackCandidate,
  selectRiskWeather,
  WeatherUnavailableError,
} from "@/integrations/kma/weather-policy";
import { createDurClient } from "@/integrations/mfds/dur.server";
import { createEasyDrugClient } from "@/integrations/mfds/easy-drug.server";
import { createPillIdentificationClient } from "@/integrations/mfds/pill-identification.server";
import { createNaverGeocoder, NaverGeocodeError } from "@/integrations/naver/geocode.server";
import { createTmapPedestrianClient } from "@/integrations/tmap/tmap.server";
import { createGeminiMedicationExtractor } from "@/lib/medication/extraction/gemini.server";
import { createMedicationCandidateResolver } from "@/lib/medication/scan/providers.server";
import {
  startMedicationImageScan,
  type MedicationScanRepository,
} from "@/lib/medication/scan/service";
import type { NotificationProvider } from "@/lib/notifications/provider";
import type {
  ClaimedGuardianAlert,
  NotificationFinalizeCommand,
  NotificationRepository,
} from "@/lib/notifications/repository.server";
import { runDemoNotificationWorker } from "@/lib/notifications/worker.server";
import {
  createSupabaseCheckInRepository,
  type CheckInRpcClient,
} from "@/lib/routing/check-in-repository.server";
import { CheckInServiceError, submitShelterCheckIn } from "@/lib/routing/check-in-service.server";
import type { RoutingRepository } from "@/lib/routing/repository.server";
import { planShadeRoute } from "@/lib/routing/service.server";

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const CHECK_IN_REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const ALERT_ID = "66666666-6666-4666-8666-666666666666";
const EVENT_ID = "77777777-7777-4777-8777-777777777777";
const PRIVATE_SENTINEL = "PRIVATE_PROVIDER_DIAGNOSTIC_010-1234-5678";

function medicationRepository() {
  const repository: MedicationScanRepository = {
    createImageSession: vi.fn(async () => undefined),
    resumeImageSession: vi.fn(async () => ({ previousAttemptCount: 0 })),
    createManualSession: vi.fn(async () => undefined),
    recordOutcome: vi.fn(async () => undefined),
    confirmAtomically: vi.fn<MedicationScanRepository["confirmAtomically"]>(async () => ({
      requestId: CHECK_IN_REQUEST_ID,
      before: null,
      after: { hri: 0, level: "L0" as const },
      medicationIds: [],
      transitionCreated: false,
    })),
  };
  return repository;
}

const image = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
  mimeType: "image/jpeg" as const,
  extension: "jpg" as const,
};

function staffAuthorization() {
  return {
    authorizeSubject: async () => ({
      kind: "allow" as const,
      profile: { id: PROFILE_ID, organizationId: ORGANIZATION_ID, role: "CARE_WORKER" as const },
      subject: { id: SUBJECT_ID, organizationId: ORGANIZATION_ID },
    }),
    resolveSubjectSession: async () => null,
  };
}

describe("Phase 8 provider and infrastructure failure matrix", () => {
  it("KMA primary failure selects an explicit partial village fallback, while no trusted reading fails closed", async () => {
    const client = createKmaClient({
      apiHubAuthKey: "fixture-api-hub-secret",
      dataGoServiceKey: "fixture-data-go-secret",
      fetcher: vi.fn(async () => new Response(PRIVATE_SENTINEL, { status: 503 })),
      timeoutMs: 1_000,
    });
    const upstreamFailure = await client
      .getPointObservations({
        longitude: 128.6014,
        latitude: 35.8714,
        at: "2026-08-24T15:00:00+09:00",
      })
      .catch((error: unknown) => error);
    expect(String(upstreamFailure)).toContain("KMA_APIHUB_HTTP_503");
    expect(String(upstreamFailure)).not.toMatch(
      /fixture-api-hub-secret|fixture-data-go-secret|PRIVATE_PROVIDER_DIAGNOSTIC/u,
    );

    const fallback = createVillageFallbackCandidate({
      forecastAt: "2026-08-24T14:00:00+09:00",
      airTemperatureC: 35,
      relativeHumidityPct: 70,
      advisory: "WARNING",
      tropicalNightStreak: 2,
      tropicalNightPartial: true,
    });
    expect(
      selectRiskWeather({
        now: "2026-08-24T15:00:00+09:00",
        primary: null,
        fallback,
      }),
    ).toMatchObject({
      mode: "FALLBACK",
      state: "partial",
      errorCode: "KMA_PRIMARY_UNAVAILABLE",
      shouldPersistWeatherSnapshot: true,
    });
    expect(() =>
      selectRiskWeather({
        now: "2026-08-24T15:00:00+09:00",
        primary: null,
        fallback: null,
        cached: null,
        lastValid: null,
      }),
    ).toThrow(WeatherUnavailableError);
  });

  it("Gemini failure returns manual entry and never reaches MFDS resolution or medication confirmation", async () => {
    const repository = medicationRepository();
    const candidateResolver = { resolve: vi.fn() };
    const extractor = createGeminiMedicationExtractor({
      apiKey: "fixture-gemini-secret",
      model: "gemini-3.5-flash",
      generate: vi.fn(async () => {
        throw new Error(PRIVATE_SENTINEL);
      }),
      logger: () => undefined,
    });

    const result = await startMedicationImageScan(
      { subjectId: SUBJECT_ID, profileId: PROFILE_ID, image },
      {
        repository,
        extractor,
        candidateResolver,
        sessionIdFactory: () => SESSION_ID,
      },
    );

    expect(result).toEqual({
      kind: "manual",
      sessionId: SESSION_ID,
      userMessage: "AI 판독이 일시적으로 어렵습니다. 직접 입력해 주세요.",
    });
    expect(candidateResolver.resolve).not.toHaveBeenCalled();
    expect(repository.confirmAtomically).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
  });

  it("MFDS failure after a valid Gemini extraction keeps an editable review candidate", async () => {
    const repository = medicationRepository();
    const pillClient = createPillIdentificationClient({
      serviceKey: "fixture-mfds-secret",
      fetcher: vi.fn(async () => new Response(PRIVATE_SENTINEL, { status: 503 })),
    });
    const durClient = createDurClient({
      serviceKey: "fixture-mfds-secret",
      fetcher: vi.fn(async () => new Response(PRIVATE_SENTINEL, { status: 503 })),
    });
    const easyDrugClient = createEasyDrugClient({
      serviceKey: "fixture-mfds-secret",
      fetcher: vi.fn(async () => new Response(PRIVATE_SENTINEL, { status: 503 })),
    });
    const candidateResolver = createMedicationCandidateResolver({
      pillClient,
      easyDrugClient,
      durClient,
      candidateIdFactory: () => "88888888-8888-4888-8888-888888888888",
    });

    const result = await startMedicationImageScan(
      { subjectId: SUBJECT_ID, profileId: PROFILE_ID, image },
      {
        repository,
        extractor: {
          extract: async () => ({
            status: "NEEDS_CONFIRMATION",
            attemptCount: 1,
            modelId: "fixture-model",
            canPersist: false,
            imageQuality: "GOOD",
            extraction: {
              imageQuality: "GOOD",
              items: [{ rawText: "라식스정", productName: "라식스정", confidence: 0.95 }],
            },
            userMessage: null,
          }),
        },
        candidateResolver,
        sessionIdFactory: () => SESSION_ID,
      },
    );

    expect(result).toMatchObject({
      kind: "review",
      sessionId: SESSION_ID,
      candidates: [
        expect.objectContaining({
          productName: "라식스정",
          evidenceSource: "GEMINI_ONLY",
          mfds: expect.objectContaining({
            sourceStatus: {
              pillIdentification: "UNAVAILABLE",
              easyDrug: "UNAVAILABLE",
              dur: "UNAVAILABLE",
            },
          }),
        }),
      ],
    });
    expect(repository.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "NEEDS_CONFIRMATION",
        candidates: [expect.objectContaining({ productName: "라식스정" })],
      }),
    );
    expect(repository.confirmAtomically).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/fixture-mfds-secret|PRIVATE_PROVIDER_DIAGNOSTIC/u);
  });

  it("Naver geocoding failure exposes no guessed coordinates and returns only a stable safe code", async () => {
    const geocoder = createNaverGeocoder({
      clientId: "fixture-naver-id",
      clientSecret: "fixture-naver-secret",
      fetcher: vi.fn(async () => new Response(PRIVATE_SENTINEL, { status: 503 })),
    });

    const error = await geocoder.search("대구광역시청").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NaverGeocodeError);
    expect(error).toMatchObject({ code: "HTTP_ERROR" });
    expect(String(error)).not.toMatch(
      /fixture-naver-id|fixture-naver-secret|PRIVATE_PROVIDER_DIAGNOSTIC|128\.6014/u,
    );
  });

  it("TMAP required-route failure returns FAILED and never invents a straight-line route", async () => {
    const repository: RoutingRepository = {
      getSpatialVersion: async () => "BUILDING:fixture-v1",
      getSpatialContext: vi.fn(async () => {
        throw new Error("must not query spatial context without a route");
      }),
      readCache: async () => null,
      writeCache: vi.fn(async () => undefined),
    };
    const tmapClient = createTmapPedestrianClient({
      appKey: "fixture-tmap-secret",
      fetchImpl: vi.fn(async () => new Response(PRIVATE_SENTINEL, { status: 503 })),
    });

    const plan = await planShadeRoute(
      {
        start: [128.6014, 35.8714],
        destination: [128.6114, 35.8814],
        shelterId: "DG-0001",
        at: "2026-08-24T15:00:00+09:00",
      },
      { repository, tmapClient, now: () => new Date("2026-08-24T06:00:00.000Z") },
    );

    expect(plan).toMatchObject({
      state: "FAILED",
      selectedCandidateId: null,
      candidates: [],
      failure: { code: "TMAP_REQUIRED_ROUTE_UNAVAILABLE", retryable: true },
    });
    expect(repository.getSpatialContext).not.toHaveBeenCalled();
    expect(repository.writeCache).not.toHaveBeenCalled();
    expect(JSON.stringify(plan)).not.toMatch(
      /fixture-tmap-secret|PRIVATE_PROVIDER_DIAGNOSTIC|128\.6014/u,
    );
  });

  it("check-in RPC failure returns SERVER_TEMPORARY and cannot manufacture a PENDING mitigation", async () => {
    const rpcClient: CheckInRpcClient = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: "08006", message: PRIVATE_SENTINEL },
      })),
    };
    const repository = createSupabaseCheckInRepository(rpcClient);

    const error = await submitShelterCheckIn(
      {
        subjectId: SUBJECT_ID,
        shelterId: "DG-0001",
        clientRequestId: CHECK_IN_REQUEST_ID,
      },
      { kind: "STAFF_SESSION", userId: PROFILE_ID },
      {
        ...staffAuthorization(),
        repository,
        actorHashSecret: "phase8-check-in-actor-hash-secret-is-long-enough",
        now: () => new Date("2026-08-24T06:00:00.000Z"),
      },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CheckInServiceError);
    expect(error).toMatchObject({ code: "SERVER_TEMPORARY", status: 503 });
    expect(String(error)).not.toContain(PRIVATE_SENTINEL);
  });

  it("notification provider failure schedules a durable retry and never claims ALERT_SENT", async () => {
    const claimed: ClaimedGuardianAlert = {
      alertId: ALERT_ID,
      eventId: EVENT_ID,
      recipientRef: "a".repeat(64),
      channel: "SMS",
      templateKey: "HEAT_L3",
      riskLevel: "L3",
      idempotencyKey: `${SUBJECT_ID}:episode:L3:ENTER`,
      attemptCount: 1,
      leaseUntil: "2026-08-24T06:01:00.000Z",
      claimToken: "123e4567-e89b-42d3-a456-426614174004",
      consentRevision: 3,
    };
    const finalizations: NotificationFinalizeCommand[] = [];
    let claimedOnce = true;
    const repository: NotificationRepository = {
      claim: async () => {
        if (!claimedOnce) return [];
        claimedOnce = false;
        return [claimed];
      },
      recheckEligibility: async () => ({ kind: "ELIGIBLE" }),
      finalize: async (command) => {
        finalizations.push(command);
        return { disposition: "APPLIED", status: command.outcome.kind };
      },
    };
    const provider: NotificationProvider = {
      sendGuardianAlert: async () => {
        throw new Error(PRIVATE_SENTINEL);
      },
    };

    const result = await runDemoNotificationWorker({
      repository,
      provider,
      deepLinkIssuer: {
        issue: async ({ eventId }) => `https://demo.onjung.example/alert/${eventId}?token=opaque`,
      },
      now: () => new Date("2026-08-24T06:00:00.000Z"),
      random: () => 0,
      limit: 10,
    });

    expect(result).toMatchObject({
      kind: "COMPLETED",
      claimed: 1,
      demoRecorded: 0,
      retryScheduled: 1,
      failedPermanent: 0,
    });
    expect(finalizations).toEqual([
      {
        alertId: ALERT_ID,
        claimToken: "123e4567-e89b-42d3-a456-426614174004",
        expectedLeaseUntil: "2026-08-24T06:01:00.000Z",
        outcome: {
          kind: "RETRY_WAIT",
          errorCode: "PROVIDER_TEMPORARY",
          nextAttemptAt: "2026-08-24T06:00:02.000Z",
        },
      },
    ]);
    expect(JSON.stringify([result, finalizations])).not.toMatch(
      /ALERT_SENT|accepted|delivered|PRIVATE_PROVIDER_DIAGNOSTIC|010-1234-5678/iu,
    );
  });
});
