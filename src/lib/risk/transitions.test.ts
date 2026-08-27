import { describe, expect, it } from "vitest";

import { decideRiskTransition, type RiskTransitionHistory } from "./transitions";

const SUBJECT_ID = "10000000-0000-4000-8000-000000000004";
const EPISODE_ID = "30000000-0000-4000-8000-000000000001";
const NEW_EPISODE_ID = "30000000-0000-4000-8000-000000000002";

const safeHistory = (level: "L0" | "L1" | "L2" = "L2"): RiskTransitionHistory => ({
  previousSnapshot: {
    level,
    computedAt: "2026-08-23T02:30:00.000Z",
  },
  lastSafeSnapshot: {
    level,
    computedAt: "2026-08-23T02:30:00.000Z",
  },
  activeEpisode: null,
  episodeTransitions: [],
});

const activeHistory = (previousLevel: "L3" | "L4"): RiskTransitionHistory => ({
  previousSnapshot: {
    level: previousLevel,
    computedAt: "2026-08-23T03:30:00.000Z",
  },
  lastSafeSnapshot: {
    level: "L2",
    computedAt: "2026-08-23T02:30:00.000Z",
  },
  activeEpisode: {
    id: EPISODE_ID,
    startedAt: "2026-08-23T03:00:00.000Z",
  },
  episodeTransitions: [
    {
      transitionType: "ENTER",
      toLevel: previousLevel,
      occurredAt: "2026-08-23T03:00:00.000Z",
    },
  ],
});

describe("risk alert transition decisions", () => {
  it("starts one episode and emits ENTER when a safe subject reaches L3", () => {
    const decision = decideRiskTransition({
      subjectId: SUBJECT_ID,
      currentLevel: "L3",
      computedAt: "2026-08-23T04:00:00.000Z",
      history: safeHistory(),
      newEpisodeId: NEW_EPISODE_ID,
    });

    expect(decision).toEqual({
      episodeMutation: {
        kind: "START",
        episode: {
          id: NEW_EPISODE_ID,
          subjectId: SUBJECT_ID,
          startedAt: "2026-08-23T04:00:00.000Z",
          entryLevel: "L3",
        },
      },
      transition: {
        subjectId: SUBJECT_ID,
        episodeId: NEW_EPISODE_ID,
        episodeStartedAt: "2026-08-23T04:00:00.000Z",
        fromLevel: "L2",
        toLevel: "L3",
        transitionType: "ENTER",
        idempotencyKey: `${SUBJECT_ID}:${NEW_EPISODE_ID}:L3:ENTER`,
        occurredAt: "2026-08-23T04:00:00.000Z",
      },
    });
  });

  it("emits an immediate ESCALATE in the same episode for L3 to L4", () => {
    const decision = decideRiskTransition({
      subjectId: SUBJECT_ID,
      currentLevel: "L4",
      computedAt: "2026-08-23T04:00:00.000Z",
      history: activeHistory("L3"),
      newEpisodeId: NEW_EPISODE_ID,
    });

    expect(decision.transition).toMatchObject({
      episodeId: EPISODE_ID,
      fromLevel: "L3",
      toLevel: "L4",
      transitionType: "ESCALATE",
      idempotencyKey: `${SUBJECT_ID}:${EPISODE_ID}:L4:ESCALATE`,
    });
    expect(decision.episodeMutation).toEqual({ kind: "NONE" });
  });

  it("emits one PERSIST_2H only after two hours at the same danger level", () => {
    const history = activeHistory("L3");
    const decision = decideRiskTransition({
      subjectId: SUBJECT_ID,
      currentLevel: "L3",
      computedAt: "2026-08-23T05:00:00.000Z",
      history,
      newEpisodeId: NEW_EPISODE_ID,
    });

    expect(decision.transition).toMatchObject({
      fromLevel: "L3",
      toLevel: "L3",
      transitionType: "PERSIST_2H",
      idempotencyKey: `${SUBJECT_ID}:${EPISODE_ID}:L3:PERSIST_2H`,
    });

    expect(
      decideRiskTransition({
        subjectId: SUBJECT_ID,
        currentLevel: "L3",
        computedAt: "2026-08-23T05:30:00.000Z",
        history: {
          ...history,
          episodeTransitions: [
            ...history.episodeTransitions,
            {
              transitionType: "PERSIST_2H",
              toLevel: "L3",
              occurredAt: "2026-08-23T05:00:00.000Z",
            },
          ],
        },
        newEpisodeId: NEW_EPISODE_ID,
      }).transition,
    ).toBeNull();
  });

  it("closes the active episode on recovery without emitting an alert", () => {
    const decision = decideRiskTransition({
      subjectId: SUBJECT_ID,
      currentLevel: "L2",
      computedAt: "2026-08-23T04:00:00.000Z",
      history: activeHistory("L3"),
      newEpisodeId: NEW_EPISODE_ID,
    });

    expect(decision).toEqual({
      episodeMutation: {
        kind: "END",
        episodeId: EPISODE_ID,
        endedAt: "2026-08-23T04:00:00.000Z",
      },
      transition: null,
    });
  });

  it("uses a new ENTER episode after recovery and does not alert for L4 to L3", () => {
    const recovered = safeHistory("L1");
    const reentry = decideRiskTransition({
      subjectId: SUBJECT_ID,
      currentLevel: "L4",
      computedAt: "2026-08-23T05:00:00.000Z",
      history: recovered,
      newEpisodeId: NEW_EPISODE_ID,
    });
    const downgrade = decideRiskTransition({
      subjectId: SUBJECT_ID,
      currentLevel: "L3",
      computedAt: "2026-08-23T04:00:00.000Z",
      history: activeHistory("L4"),
      newEpisodeId: NEW_EPISODE_ID,
    });

    expect(reentry.transition).toMatchObject({
      episodeId: NEW_EPISODE_ID,
      transitionType: "ENTER",
      fromLevel: "L1",
      toLevel: "L4",
    });
    expect(downgrade).toEqual({ episodeMutation: { kind: "NONE" }, transition: null });
  });
});
