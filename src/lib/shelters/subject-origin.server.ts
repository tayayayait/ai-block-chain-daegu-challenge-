import "@tanstack/react-start/server-only";

import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";

const SubjectIdSchema = z.string().uuid();
const OriginRowSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

export interface SubjectShelterOriginRpcClient {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>,
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

export interface SubjectShelterOrigin {
  readonly latitude: number;
  readonly longitude: number;
}

export type SubjectShelterOriginErrorCode =
  "INVALID_REQUEST" | "NOT_FOUND" | "READ_FAILED" | "INVALID_RESPONSE";

export class SubjectShelterOriginError extends Error {
  constructor(readonly code: SubjectShelterOriginErrorCode) {
    super(`Subject shelter origin failed: ${code}`);
    this.name = "SubjectShelterOriginError";
  }
}

function defaultClient(): SubjectShelterOriginRpcClient {
  return createAdminSupabaseClient() as unknown as SubjectShelterOriginRpcClient;
}

export function createSubjectShelterOriginRepository(
  client: SubjectShelterOriginRpcClient = defaultClient(),
) {
  return Object.freeze({
    async findBySubjectId(subjectId: string): Promise<SubjectShelterOrigin> {
      const parsedId = SubjectIdSchema.safeParse(subjectId);
      if (!parsedId.success) throw new SubjectShelterOriginError("INVALID_REQUEST");

      let response: { readonly data: unknown; readonly error: unknown };
      try {
        response = await client.rpc("get_subject_shelter_origin", {
          p_subject_id: parsedId.data,
        });
      } catch {
        throw new SubjectShelterOriginError("READ_FAILED");
      }
      if (response.error !== null) throw new SubjectShelterOriginError("READ_FAILED");

      const rows = z.array(OriginRowSchema).safeParse(response.data);
      if (!rows.success) throw new SubjectShelterOriginError("INVALID_RESPONSE");
      if (rows.data.length === 0) throw new SubjectShelterOriginError("NOT_FOUND");
      if (rows.data.length !== 1) throw new SubjectShelterOriginError("INVALID_RESPONSE");
      return Object.freeze(rows.data[0] as SubjectShelterOrigin);
    },
  });
}
