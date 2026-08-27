import "@tanstack/react-start/server-only";

import { AppError } from "@/lib/error-dto";
import { getShelterEmptyAction, type ShelterEmptyAction } from "./empty-state";
import type { PublicShelterDto } from "./public-dto";
import { createSupabaseShelterRepository, type ShelterRepository } from "./repository.server";
import { parseShelterSearchParams, type ShelterSearchQuery } from "./search-schema";

export interface ShelterSearchResult {
  readonly query: ShelterSearchQuery;
  readonly shelters: readonly PublicShelterDto[];
  readonly emptyAction: ShelterEmptyAction;
}

export async function searchShelters(
  input: URLSearchParams | Readonly<Record<string, unknown>>,
  repository: ShelterRepository = createSupabaseShelterRepository(),
): Promise<ShelterSearchResult> {
  let query: ShelterSearchQuery;
  try {
    query = parseShelterSearchParams(input);
  } catch {
    throw new AppError("INVALID_REQUEST");
  }

  const shelters = await repository.search(query);
  return Object.freeze({
    query,
    shelters,
    emptyAction: getShelterEmptyAction(query, shelters.length),
  });
}
