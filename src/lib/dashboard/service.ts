import { AppError } from "@/lib/error-dto";

import type {
  DashboardAcknowledgeInput,
  DashboardReadInput,
  DashboardRepository,
} from "./repository";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

function assertSafeIdentifier(value: string): void {
  if (!SAFE_IDENTIFIER.test(value)) throw new AppError("INVALID_REQUEST");
}

export function createDashboardService(repository: DashboardRepository) {
  return Object.freeze({
    async read(input: DashboardReadInput) {
      assertSafeIdentifier(input.actorId);
      return repository.read(input);
    },
    async acknowledge(input: DashboardAcknowledgeInput) {
      assertSafeIdentifier(input.actorId);
      assertSafeIdentifier(input.transitionId);
      return repository.acknowledgeL4(input);
    },
  });
}
