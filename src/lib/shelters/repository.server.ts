import "@tanstack/react-start/server-only";

import { AppError } from "@/lib/error-dto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";
import {
  ShelterIdSchema,
  toPublicShelterDto,
  toShelterReportTargetDto,
  type PublicShelterDto,
  type ShelterReportTargetDto,
} from "./public-dto";
import {
  DEFAULT_PUBLIC_SHELTER_ORIGIN,
  ShelterSearchQuerySchema,
  type ShelterSearchQuery,
} from "./search-schema";

export interface ShelterRpcClient {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown; readonly error: unknown }>;
}

export interface ShelterRepository {
  search(query: ShelterSearchQuery): Promise<readonly PublicShelterDto[]>;
}

export interface ShelterLookupRepository {
  getById(shelterId: string): Promise<ShelterReportTargetDto>;
}

function defaultRpcClient(): ShelterRpcClient {
  return createAdminSupabaseClient() as unknown as ShelterRpcClient;
}

export function createSupabaseShelterRepository(
  client: ShelterRpcClient = defaultRpcClient(),
): ShelterRepository & ShelterLookupRepository {
  return Object.freeze({
    async search(input: ShelterSearchQuery): Promise<readonly PublicShelterDto[]> {
      const query = ShelterSearchQuerySchema.parse(input);
      const isDefaultOrigin =
        query.lat === DEFAULT_PUBLIC_SHELTER_ORIGIN.lat &&
        query.lng === DEFAULT_PUBLIC_SHELTER_ORIGIN.lng;
      const radiusM = isDefaultOrigin && query.gu ? 30_000 : query.radius;

      const response = await client.rpc("search_shelters", {
        p_lat: query.lat,
        p_lng: query.lng,
        p_radius_m: radiusM,
        p_gu: query.gu ?? null,
        p_im_bank_only: query.imBank,
        p_open_state: query.open,
        p_sort: query.sort,
        p_limit: query.limit,
      });

      if (response.error !== null) throw new AppError("SERVER_TEMPORARY");
      if (!Array.isArray(response.data)) throw new AppError("SERVER_TEMPORARY");

      try {
        return Object.freeze(response.data.map(toPublicShelterDto));
      } catch (cause) {
        throw new AppError("SERVER_TEMPORARY", { cause });
      }
    },
    async getById(rawShelterId: string): Promise<ShelterReportTargetDto> {
      const shelterId = ShelterIdSchema.parse(rawShelterId);
      const response = await client.rpc("get_shelter_by_id", { p_shelter_id: shelterId });
      if (response.error !== null) throw new AppError("SERVER_TEMPORARY");
      if (!Array.isArray(response.data)) throw new AppError("SERVER_TEMPORARY");
      if (response.data.length === 0) throw new AppError("NOT_FOUND");
      if (response.data.length !== 1) throw new AppError("SERVER_TEMPORARY");

      try {
        return toShelterReportTargetDto(response.data[0]);
      } catch (cause) {
        throw new AppError("SERVER_TEMPORARY", { cause });
      }
    },
  });
}
