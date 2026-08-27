import type { DashboardSearch } from "./search";
import type { DashboardSnapshot } from "./types";

export interface DashboardReadInput {
  actorId: string;
  search: DashboardSearch;
}

export interface DashboardAcknowledgeInput {
  actorId: string;
  transitionId: string;
}

export interface DashboardRepository {
  read(input: DashboardReadInput): Promise<DashboardSnapshot>;
  acknowledgeL4(input: DashboardAcknowledgeInput): Promise<void>;
}
