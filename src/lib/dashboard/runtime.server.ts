import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCookies, setCookie, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { AppError } from "@/lib/error-dto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";
import { createSessionSupabaseClient } from "@/lib/supabase/session.server";

import type { DashboardSearch } from "./search";
import { createDashboardService } from "./service";
import { createSupabaseDashboardRepository } from "./supabase-repository.server";

const UUID = z.string().uuid();

function createRequestDashboardClient() {
  setResponseHeader("cache-control", "private, no-cache, no-store, must-revalidate, max-age=0");
  setResponseHeader("expires", "0");
  setResponseHeader("pragma", "no-cache");

  return createSessionSupabaseClient({
    getAll: () =>
      Object.entries(getCookies()).map(([name, value]) => ({
        name,
        value,
      })),
    setAll: (cookiesToSet) => {
      for (const { name, value, options } of cookiesToSet) {
        setCookie(name, value, options);
      }
    },
  });
}

/** The browser cannot choose the actor; Supabase verifies the session token first. */
export async function resolveDashboardActorId(
  client: Pick<SupabaseClient, "auth">,
): Promise<string> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new AppError("NOT_FOUND");
    const actorId = UUID.safeParse(data.user.id);
    if (!actorId.success) throw new AppError("NOT_FOUND");
    return actorId.data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("NOT_FOUND");
  }
}

async function requestDashboardService() {
  const sessionClient = createRequestDashboardClient();
  const actorId = await resolveDashboardActorId(sessionClient);
  const repository = createSupabaseDashboardRepository(sessionClient, createAdminSupabaseClient());
  return { actorId, service: createDashboardService(repository) };
}

export async function readDashboardSnapshot(search: DashboardSearch) {
  const { actorId, service } = await requestDashboardService();
  return service.read({ actorId, search });
}

export async function acknowledgeDashboardAlert(transitionId: string) {
  const { actorId, service } = await requestDashboardService();
  return service.acknowledge({ actorId, transitionId });
}
