import "@tanstack/react-start/server-only";

import { AppError } from "@/lib/error-dto";
import { ShelterIdSchema, type ShelterReportTargetDto } from "./public-dto";
import { createSupabaseShelterRepository, type ShelterLookupRepository } from "./repository.server";

export async function getShelterById(
  rawShelterId: unknown,
  repository: ShelterLookupRepository = createSupabaseShelterRepository(),
): Promise<ShelterReportTargetDto> {
  const parsed = ShelterIdSchema.safeParse(rawShelterId);
  if (!parsed.success) throw new AppError("INVALID_REQUEST");
  return repository.getById(parsed.data);
}
