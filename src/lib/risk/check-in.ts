import type { AttestState } from "@/lib/domain-types";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export interface ShelterCheckInForRisk {
  attestationState: AttestState;
  checkedInAt: Date;
}

export function hasVerifiedShelterCheckInWithin24h(
  checkIns: readonly ShelterCheckInForRisk[],
  computedAt: Date,
): boolean {
  const computedAtMs = computedAt.getTime();
  if (!Number.isFinite(computedAtMs)) return false;

  return checkIns.some(({ attestationState, checkedInAt }) => {
    if (attestationState !== "VERIFIED") return false;

    const checkedInAtMs = checkedInAt.getTime();
    if (!Number.isFinite(checkedInAtMs)) return false;

    const ageMs = computedAtMs - checkedInAtMs;
    return ageMs >= 0 && ageMs <= TWENTY_FOUR_HOURS_MS;
  });
}
