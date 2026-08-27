import { describe, expect, it, vi } from "vitest";

import { computeHri, type HriInput } from "@/lib/risk/hri";
import {
  recomputeRiskSubject,
  type RiskCommitCommand,
  type RiskCommitResult,
  type RiskRecomputeRepository,
  type RiskSnapshotWrite,
  type RiskSubjectFacts,
} from "@/lib/risk/recompute-risk";
import type {
  AlertTransitionWrite,
  RiskEpisode,
  RiskTransitionHistory,
} from "@/lib/risk/transitions";
import {
  confirmMedicationReview,
  prepareManualMedicationReview,
  type MedicationScanRepository,
} from "@/lib/medication/scan/service";
import { medicationReviewDefaultValues } from "@/lib/medication/scan/schema";
import { checkInMitigationStatus } from "@/lib/routing/check-in-policy";
import type {
  CheckInRepository,
  PendingCheckInRecord,
  PendingCheckInWrite,
} from "@/lib/routing/check-in-repository.server";
import { submitShelterCheckIn } from "@/lib/routing/check-in-service.server";

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "33333333-3333-4333-8333-333333333333";
const CHECK_IN_ID = "44444444-4444-4444-8444-444444444444";
const CHECK_IN_REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const SCAN_SESSION_ID = "66666666-6666-4666-8666-666666666666";
const MEDICATION_REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const MEDICATION_ID = "88888888-8888-4888-8888-888888888888";
const SHELTER_ID = "DG-0001";

class MemoryRiskRepository implements RiskRecomputeRepository {
  facts: RiskSubjectFacts;
  readonly snapshots: RiskSnapshotWrite[] = [];
  readonly transitions: AlertTransitionWrite[] = [];
  private activeEpisode: (RiskEpisode & { endedAt: string | null }) | null = null;

  constructor(facts: RiskSubjectFacts) {
    this.facts = facts;
  }

  async loadRiskFacts(subjectId: string): Promise<RiskSubjectFacts | null> {
    return subjectId === this.facts.subjectId ? this.facts : null;
  }

  async loadRiskHistory(subjectId: string): Promise<RiskTransitionHistory> {
    const subjectSnapshots = this.snapshots
      .filter((snapshot) => snapshot.subjectId === subjectId)
      .sort((left, right) => right.computedAt.localeCompare(left.computedAt));
    const previousSnapshot = subjectSnapshots[0] ?? null;
    const lastSafeSnapshot = subjectSnapshots.find(
      ({ level }) => level === "L0" || level === "L1" || level === "L2",
    );
    const activeEpisode =
      this.activeEpisode?.subjectId === subjectId && this.activeEpisode.endedAt === null
        ? this.activeEpisode
        : null;

    return {
      previousSnapshot: previousSnapshot
        ? { level: previousSnapshot.level, computedAt: previousSnapshot.computedAt }
        : null,
      lastSafeSnapshot: lastSafeSnapshot
        ? { level: lastSafeSnapshot.level, computedAt: lastSafeSnapshot.computedAt }
        : null,
      activeEpisode: activeEpisode
        ? { id: activeEpisode.id, startedAt: activeEpisode.startedAt }
        : null,
      episodeTransitions: activeEpisode
        ? this.transitions
            .filter(({ episodeId }) => episodeId === activeEpisode.id)
            .map(({ transitionType, toLevel, occurredAt }) => ({
              transitionType,
              toLevel,
              occurredAt,
            }))
        : [],
    };
  }

  async commitRiskComputation(command: RiskCommitCommand): Promise<RiskCommitResult> {
    const existingSnapshot = this.snapshots.find(
      (snapshot) =>
        snapshot.subjectId === command.snapshot.subjectId &&
        snapshot.bucketStart === command.snapshot.bucketStart &&
        snapshot.inputHash === command.snapshot.inputHash,
    );
    if (!existingSnapshot) this.snapshots.push(command.snapshot);

    if (command.episodeMutation.kind === "START" && this.activeEpisode === null) {
      this.activeEpisode = { ...command.episodeMutation.episode, endedAt: null };
    } else if (
      command.episodeMutation.kind === "END" &&
      this.activeEpisode?.id === command.episodeMutation.episodeId
    ) {
      this.activeEpisode.endedAt = command.episodeMutation.endedAt;
    }

    const transitionInserted = Boolean(
      command.transition &&
      !this.transitions.some(
        ({ idempotencyKey }) => idempotencyKey === command.transition?.idempotencyKey,
      ),
    );
    if (command.transition && transitionInserted) this.transitions.push(command.transition);

    return {
      snapshot: existingSnapshot ?? command.snapshot,
      snapshotInserted: existingSnapshot === undefined,
      transitionInserted,
    };
  }
}

function riskFacts(overrides: Partial<RiskSubjectFacts> = {}): RiskSubjectFacts {
  return {
    subjectId: SUBJECT_ID,
    birthYear: 1940,
    livesAlone: true,
    chronicDisease: true,
    hasCooling: false,
    medicationProfileRegisteredAt: "2026-08-01T00:00:00.000Z",
    medications: [],
    shelterCheckins: [],
    weather: {
      snapshotId: "weather-phase8-1",
      feelsLikeC: 38,
      heatAdvisory: "NONE",
      tropicalNightStreak: 0,
    },
    ...overrides,
  };
}

function checkInRepository(): CheckInRepository {
  return {
    createPending: vi.fn(async (input: PendingCheckInWrite): Promise<PendingCheckInRecord> => ({
      id: CHECK_IN_ID,
      attestationState: input.attestationState,
      checkedInAt: input.checkedInAt,
      jobState: "PENDING",
    })),
  };
}

function baseMedicationInput(): HriInput {
  return {
    feelsLikeC: 38,
    heatAdvisory: "NONE",
    tropicalNightStreak: 0,
    medHigh: 0,
    medMid: 0,
    medRegistered: false,
    age: 75,
    livesAlone: true,
    chronicDisease: true,
    noCooling: false,
    shelterCheckInVerified24h: false,
  };
}

function medicationRepository(): MedicationScanRepository {
  return {
    createImageSession: vi.fn(async () => undefined),
    resumeImageSession: vi.fn(async () => ({ previousAttemptCount: 0 })),
    createManualSession: vi.fn(async () => undefined),
    recordOutcome: vi.fn(async () => undefined),
    confirmAtomically: vi.fn<MedicationScanRepository["confirmAtomically"]>(async (command) => {
      const before = computeHri(baseMedicationInput());
      const highClasses = new Set(
        command.medications
          .filter(({ riskTier, heatClass }) => riskTier === "HIGH" && heatClass !== null)
          .map(({ heatClass }) => heatClass),
      ).size;
      const midClasses = new Set(
        command.medications
          .filter(({ riskTier, heatClass }) => riskTier === "MID" && heatClass !== null)
          .map(({ heatClass }) => heatClass),
      ).size;
      const after = computeHri({
        ...baseMedicationInput(),
        medRegistered: true,
        medHigh: highClasses,
        medMid: midClasses,
      });
      return {
        requestId: command.requestId,
        before: { hri: before.score, level: before.level },
        after: { hri: after.score, level: after.level },
        medicationIds: [MEDICATION_ID],
        transitionCreated: before.level !== after.level,
      };
    }),
  };
}

describe("Phase 8 critical risk flows", () => {
  it("keeps a submitted check-in at PENDING/C=0 and applies C=6 only after a confirmed EAS result is reflected", async () => {
    const checkedInAt = new Date("2026-08-24T06:00:00.000Z");
    const repository = checkInRepository();
    const submission = await submitShelterCheckIn(
      {
        subjectId: SUBJECT_ID,
        shelterId: SHELTER_ID,
        clientRequestId: CHECK_IN_REQUEST_ID,
      },
      { kind: "STAFF_SESSION", userId: PROFILE_ID },
      {
        authorizeSubject: async () => ({
          kind: "allow",
          profile: { id: PROFILE_ID, organizationId: ORGANIZATION_ID, role: "CARE_WORKER" },
          subject: { id: SUBJECT_ID, organizationId: ORGANIZATION_ID },
        }),
        resolveSubjectSession: async () => null,
        repository,
        actorHashSecret: "phase8-check-in-actor-hash-secret-is-long-enough",
        now: () => checkedInAt,
      },
    );

    expect(submission).toEqual({
      checkInId: CHECK_IN_ID,
      attestationState: "PENDING",
      displayStatus: "기록 확인 중",
      contribution: 0,
    });
    expect(
      checkInMitigationStatus({
        attestationState: "PENDING",
        checkedInAt,
        computedAt: new Date("2026-08-24T06:05:00.000Z"),
      }),
    ).toEqual({ displayStatus: "RECORDING_PENDING", contribution: 0 });

    const riskRepository = new MemoryRiskRepository(
      riskFacts({
        shelterCheckins: [{ checkedInAt: checkedInAt.toISOString(), attestationState: "PENDING" }],
      }),
    );
    const pendingRisk = await recomputeRiskSubject({
      subjectId: SUBJECT_ID,
      computedAt: new Date("2026-08-24T06:05:00.000Z"),
      repository: riskRepository,
      episodeIdFactory: () => "99999999-9999-4999-8999-999999999999",
    });

    expect(pendingRisk.hri).toMatchObject({
      score: 62,
      level: "L3",
      breakdown: { E: 42, M: 0, P: 20, C: 0 },
    });
    expect(pendingRisk.transition?.transitionType).toBe("ENTER");

    // The test injects a confirmed external result into the trusted fact store. It does not
    // claim that a live Base Sepolia RPC/schema/private-key configuration was exercised.
    riskRepository.facts = riskFacts({
      shelterCheckins: [{ checkedInAt: checkedInAt.toISOString(), attestationState: "VERIFIED" }],
    });
    expect(
      checkInMitigationStatus({
        attestationState: "VERIFIED",
        checkedInAt,
        verifiedAt: new Date("2026-08-24T06:06:00.000Z"),
        computedAt: new Date("2026-08-24T06:10:00.000Z"),
      }),
    ).toEqual({ displayStatus: "MITIGATION_APPLIED", contribution: 6 });

    const verifiedRisk = await recomputeRiskSubject({
      subjectId: SUBJECT_ID,
      computedAt: new Date("2026-08-24T06:10:00.000Z"),
      repository: riskRepository,
      episodeIdFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(verifiedRisk.hri).toMatchObject({
      score: 56,
      level: "L2",
      breakdown: { E: 42, M: 0, P: 20, C: 6 },
    });
    expect(verifiedRisk.transition).toBeNull();
  });

  it("recomputes HRI only after an operator confirms a classified medication", async () => {
    const repository = medicationRepository();
    const prepared = await prepareManualMedicationReview(
      {
        subjectId: SUBJECT_ID,
        profileId: PROFILE_ID,
        productName: "라식스정",
        itemSeq: "",
        ingredientName: "푸로세미드",
      },
      {
        repository,
        sessionIdFactory: () => SCAN_SESSION_ID,
        candidateIdFactory: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    );
    const review = medicationReviewDefaultValues({
      requestId: MEDICATION_REQUEST_ID,
      subjectId: SUBJECT_ID,
      scanSessionId: SCAN_SESSION_ID,
      candidates: prepared.candidates,
    });

    expect(prepared.candidates[0]).toMatchObject({
      ingredientName: "푸로세미드",
      heatClass: "이뇨제",
      riskTier: "HIGH",
      source: "MANUAL",
    });
    expect(repository.confirmAtomically).not.toHaveBeenCalled();

    const receipt = await confirmMedicationReview(
      { ...review, confirmed: true },
      {
        repository,
        profileId: PROFILE_ID,
        now: () => new Date("2026-08-24T06:20:00.000Z"),
      },
    );

    expect(receipt).toEqual({
      requestId: MEDICATION_REQUEST_ID,
      before: { hri: 56, level: "L2" },
      after: { hri: 62, level: "L3" },
      medicationIds: [MEDICATION_ID],
      transitionCreated: true,
    });
    expect(repository.confirmAtomically).toHaveBeenCalledOnce();
  });

  it("deduplicates an exact risk rerun by snapshot input hash and transition idempotency key", async () => {
    const repository = new MemoryRiskRepository(riskFacts());
    const computedAt = new Date("2026-08-24T06:25:00.000Z");
    const input = {
      subjectId: SUBJECT_ID,
      computedAt,
      repository,
      episodeIdFactory: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    } as const;

    const first = await recomputeRiskSubject(input);
    const second = await recomputeRiskSubject(input);

    expect(first.commit).toMatchObject({ snapshotInserted: true, transitionInserted: true });
    expect(second.commit).toMatchObject({ snapshotInserted: false, transitionInserted: false });
    expect(repository.snapshots).toHaveLength(1);
    expect(repository.transitions).toHaveLength(1);
    expect(second.transition).toBeNull();
    expect(first.transition?.idempotencyKey).toBe(
      `${SUBJECT_ID}:cccccccc-cccc-4ccc-8ccc-cccccccccccc:L3:ENTER`,
    );
  });
});
