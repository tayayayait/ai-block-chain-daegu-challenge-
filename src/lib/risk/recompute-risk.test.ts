import { describe, expect, it, vi } from "vitest";

import {
  buildRiskInputHash,
  deriveHriInput,
  recomputeRiskSubject,
  riskBucketStart,
  type RiskSubjectFacts,
} from "./recompute-risk";
import type { RiskTransitionHistory } from "./transitions";

const SUBJECT_ID = "10000000-0000-4000-8000-000000000004";
const EPISODE_ID = "30000000-0000-4000-8000-000000000004";
const COMPUTED_AT = new Date("2025-12-31T15:10:00.000Z"); // 2026-01-01 KST

function subjectFacts(overrides: Partial<RiskSubjectFacts> = {}): RiskSubjectFacts {
  return {
    subjectId: SUBJECT_ID,
    birthYear: 1940,
    livesAlone: true,
    chronicDisease: true,
    hasCooling: false,
    medicationProfileRegisteredAt: "2025-08-01T00:00:00.000Z",
    medications: [
      { heatClass: "이뇨제", riskTier: "HIGH" },
      { heatClass: "이뇨제", riskTier: "HIGH" },
      { heatClass: "이뇨제", riskTier: "MID" },
      { heatClass: "항치매제", riskTier: "MID" },
      { heatClass: null, riskTier: "NONE" },
    ],
    shelterCheckins: [
      { checkedInAt: "2025-12-30T15:10:00.000Z", attestationState: "VERIFIED" },
      { checkedInAt: "2025-12-31T14:00:00.000Z", attestationState: "UNVERIFIED" },
      { checkedInAt: "2025-12-31T16:00:00.000Z", attestationState: "VERIFIED" },
    ],
    weather: {
      snapshotId: "501",
      feelsLikeC: 38,
      heatAdvisory: "NONE",
      tropicalNightStreak: 0,
    },
    ...overrides,
  };
}

const safeHistory: RiskTransitionHistory = {
  previousSnapshot: { level: "L2", computedAt: "2025-12-31T14:30:00.000Z" },
  lastSafeSnapshot: { level: "L2", computedAt: "2025-12-31T14:30:00.000Z" },
  activeEpisode: null,
  episodeTransitions: [],
};

describe("risk recomputation input", () => {
  it("uses the KST calculation year, de-duplicates medication classes, and only trusts a VERIFIED 24h check-in", () => {
    expect(deriveHriInput(subjectFacts(), COMPUTED_AT)).toEqual({
      feelsLikeC: 38,
      heatAdvisory: "NONE",
      tropicalNightStreak: 0,
      medHigh: 1,
      medMid: 1,
      medRegistered: true,
      age: 86,
      livesAlone: true,
      chronicDisease: true,
      noCooling: true,
      shelterCheckInVerified24h: true,
    });
  });

  it("does not apply medication or check-in credit when registration is absent and verification is stale", () => {
    const facts = subjectFacts({
      medicationProfileRegisteredAt: null,
      shelterCheckins: [
        { checkedInAt: "2025-12-30T15:09:59.999Z", attestationState: "VERIFIED" },
        { checkedInAt: "2025-12-31T14:00:00.000Z", attestationState: "PENDING" },
      ],
    });

    expect(deriveHriInput(facts, COMPUTED_AT)).toMatchObject({
      medHigh: 0,
      medMid: 0,
      medRegistered: false,
      shelterCheckInVerified24h: false,
    });
  });

  it("floors instants to a 30-minute bucket and hashes normalized inputs deterministically", () => {
    const bucket = riskBucketStart(new Date("2026-08-23T04:44:59.999Z"));
    const input = deriveHriInput(subjectFacts(), COMPUTED_AT);
    const first = buildRiskInputHash({
      subjectId: SUBJECT_ID,
      weatherSnapshotId: "501",
      bucketStart: bucket,
      input,
    });
    const second = buildRiskInputHash({
      input: { ...input },
      bucketStart: bucket,
      weatherSnapshotId: "501",
      subjectId: SUBJECT_ID,
    });

    expect(bucket).toBe("2026-08-23T04:30:00.000Z");
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(second).toBe(first);
    expect(
      buildRiskInputHash({
        subjectId: SUBJECT_ID,
        weatherSnapshotId: "502",
        bucketStart: bucket,
        input,
      }),
    ).not.toBe(first);
  });
});

describe("recomputeRiskSubject", () => {
  it("persists the HRI snapshot and ENTER transition without claiming an alert was sent", async () => {
    const commitRiskComputation = vi.fn(async (command) => ({
      snapshot: command.snapshot,
      snapshotInserted: true,
      transitionInserted: command.transition !== null,
    }));
    const repository = {
      loadRiskFacts: vi.fn(async () => subjectFacts()),
      loadRiskHistory: vi.fn(async () => safeHistory),
      commitRiskComputation,
    };

    const result = await recomputeRiskSubject({
      subjectId: SUBJECT_ID,
      computedAt: COMPUTED_AT,
      repository,
      episodeIdFactory: () => EPISODE_ID,
    });

    expect(result.hri).toMatchObject({
      score: 65,
      level: "L3",
      breakdown: { E: 42, M: 9, P: 20, C: 6 },
    });
    expect(result.commit).toMatchObject({ snapshotInserted: true, transitionInserted: true });
    expect(commitRiskComputation).toHaveBeenCalledOnce();

    const command = commitRiskComputation.mock.calls[0]?.[0];
    expect(command?.snapshot).toMatchObject({
      subjectId: SUBJECT_ID,
      weatherSnapshotId: "501",
      hri: 65,
      level: "L3",
      bucketStart: "2025-12-31T15:00:00.000Z",
      computedAt: "2025-12-31T15:10:00.000Z",
    });
    expect(command?.snapshot.inputHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(command?.transition).toMatchObject({
      episodeId: EPISODE_ID,
      transitionType: "ENTER",
    });
    expect(command).not.toHaveProperty("careEvent");
  });
});
