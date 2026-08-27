import type { ShelterSearchQuery } from "./search-schema";

export type ShelterEmptyAction =
  | Readonly<{ type: "NONE" }>
  | Readonly<{ type: "RESET_FILTERS" }>
  | Readonly<{ type: "EXPAND_RADIUS"; radius: 1_000 | 3_000 }>
  | Readonly<{ type: "NO_RESULTS" }>;

export function getShelterEmptyAction(
  query: ShelterSearchQuery,
  resultCount: number,
): ShelterEmptyAction {
  if (resultCount > 0) return Object.freeze({ type: "NONE" });

  const hasFilter = query.gu !== undefined || query.imBank || query.open !== "ALL";
  if (hasFilter) return Object.freeze({ type: "RESET_FILTERS" });
  if (query.radius === 500) return Object.freeze({ type: "EXPAND_RADIUS", radius: 1_000 });
  if (query.radius === 1_000) return Object.freeze({ type: "EXPAND_RADIUS", radius: 3_000 });
  return Object.freeze({ type: "NO_RESULTS" });
}
