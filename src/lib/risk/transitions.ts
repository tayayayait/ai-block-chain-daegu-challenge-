import type { RiskLevel } from "@/lib/domain-types";

export type RiskTransitionType = "ENTER" | "ESCALATE" | "PERSIST_2H";

export interface RiskSnapshotHistoryItem {
  readonly level: RiskLevel;
  readonly computedAt: string;
}

export interface RiskEpisode {
  readonly id: string;
  readonly subjectId: string;
  readonly startedAt: string;
  readonly entryLevel: "L3" | "L4";
}

export interface RiskEpisodeHistoryItem {
  readonly transitionType: RiskTransitionType;
  readonly toLevel: "L3" | "L4";
  readonly occurredAt: string;
}

export interface RiskTransitionHistory {
  readonly previousSnapshot: RiskSnapshotHistoryItem | null;
  readonly lastSafeSnapshot: RiskSnapshotHistoryItem | null;
  readonly activeEpisode: Pick<RiskEpisode, "id" | "startedAt"> | null;
  readonly episodeTransitions: readonly RiskEpisodeHistoryItem[];
}

export interface AlertTransitionWrite {
  readonly subjectId: string;
  readonly episodeId: string;
  readonly episodeStartedAt: string;
  readonly fromLevel: RiskLevel;
  readonly toLevel: "L3" | "L4";
  readonly transitionType: RiskTransitionType;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export type RiskEpisodeMutation =
  | { readonly kind: "NONE" }
  | { readonly kind: "START"; readonly episode: RiskEpisode }
  | { readonly kind: "END"; readonly episodeId: string; readonly endedAt: string };

export interface RiskTransitionDecision {
  readonly episodeMutation: RiskEpisodeMutation;
  readonly transition: AlertTransitionWrite | null;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;

function isDangerLevel(level: RiskLevel): level is "L3" | "L4" {
  return level === "L3" || level === "L4";
}

function instantMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError("Risk transition time must be valid");
  return parsed;
}

function buildTransition(
  subjectId: string,
  episodeId: string,
  episodeStartedAt: string,
  fromLevel: RiskLevel,
  toLevel: "L3" | "L4",
  transitionType: RiskTransitionType,
  occurredAt: string,
): AlertTransitionWrite {
  return {
    subjectId,
    episodeId,
    episodeStartedAt,
    fromLevel,
    toLevel,
    transitionType,
    idempotencyKey: `${subjectId}:${episodeId}:${toLevel}:${transitionType}`,
    occurredAt,
  };
}

export function decideRiskTransition(input: {
  readonly subjectId: string;
  readonly currentLevel: RiskLevel;
  readonly computedAt: string;
  readonly history: RiskTransitionHistory;
  readonly newEpisodeId: string;
}): RiskTransitionDecision {
  const { subjectId, currentLevel, computedAt, history } = input;
  const activeEpisode = history.activeEpisode;

  instantMs(computedAt);

  if (!isDangerLevel(currentLevel)) {
    return {
      episodeMutation: activeEpisode
        ? { kind: "END", episodeId: activeEpisode.id, endedAt: computedAt }
        : { kind: "NONE" },
      transition: null,
    };
  }

  if (!activeEpisode) {
    const episode: RiskEpisode = {
      id: input.newEpisodeId,
      subjectId,
      startedAt: computedAt,
      entryLevel: currentLevel,
    };
    const fromLevel = history.lastSafeSnapshot?.level ?? "L0";

    return {
      episodeMutation: { kind: "START", episode },
      transition: buildTransition(
        subjectId,
        episode.id,
        episode.startedAt,
        fromLevel,
        currentLevel,
        "ENTER",
        computedAt,
      ),
    };
  }

  const previousLevel = history.previousSnapshot?.level;
  if (previousLevel === "L3" && currentLevel === "L4") {
    return {
      episodeMutation: { kind: "NONE" },
      transition: buildTransition(
        subjectId,
        activeEpisode.id,
        activeEpisode.startedAt,
        "L3",
        "L4",
        "ESCALATE",
        computedAt,
      ),
    };
  }

  const hasPersistenceAlert = history.episodeTransitions.some(
    ({ transitionType }) => transitionType === "PERSIST_2H",
  );
  const persistedLongEnough =
    instantMs(computedAt) - instantMs(activeEpisode.startedAt) >= TWO_HOURS_MS;
  if (!hasPersistenceAlert && persistedLongEnough && previousLevel === currentLevel) {
    return {
      episodeMutation: { kind: "NONE" },
      transition: buildTransition(
        subjectId,
        activeEpisode.id,
        activeEpisode.startedAt,
        currentLevel,
        currentLevel,
        "PERSIST_2H",
        computedAt,
      ),
    };
  }

  return { episodeMutation: { kind: "NONE" }, transition: null };
}
