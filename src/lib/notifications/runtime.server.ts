import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  createAlertAccessGrant,
  type AlertAccessRepository,
} from "@/lib/alerts/access-token.server";
import { createSupabaseAlertRepository } from "@/lib/alerts/repository.server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";

import {
  createDemoNotificationProvider,
  type DemoNotificationRecord,
  type DemoNotificationRepository,
} from "./demo-provider.server";
import {
  createSupabaseNotificationRepository,
  type NotificationRpcClient,
  type NotificationRepository,
} from "./repository.server";
import {
  runDemoNotificationWorker,
  type DemoNotificationWorkerResult,
  type NotificationDeepLinkIssuer,
} from "./worker.server";
import {
  isNotificationCronAuthorized,
  NOTIFICATION_CRON_SECRET_MIN_LENGTH,
} from "./cron-auth.server";

export { isNotificationCronAuthorized, NOTIFICATION_CRON_SECRET_MIN_LENGTH };

const DemoEnvironmentSchema = z.object({
  NOTIFICATION_PROVIDER: z.literal("demo"),
  NOTIFICATION_LIVE_SEND_ENABLED: z.literal(false),
});

const WorkerLimitSchema = z.number().int().min(1).max(100);
const DeepLinkIssueInputSchema = z
  .object({
    alertId: z.string().uuid(),
    eventId: z.string().uuid(),
    claimToken: z.string().uuid(),
    expectedLeaseUntil: z.string().datetime({ offset: true }),
  })
  .strict();

export class NotificationRuntimeError extends Error {
  constructor(readonly code: "UNSAFE_NOTIFICATION_MODE" | "INVALID_PUBLIC_ORIGIN") {
    super(code);
    this.name = "NotificationRuntimeError";
  }
}

export function normalizeNotificationPublicOrigin(rawOrigin: string): string {
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new NotificationRuntimeError("INVALID_PUBLIC_ORIGIN");
  }

  const loopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  const allowedProtocol = url.protocol === "https:" || (url.protocol === "http:" && loopback);
  if (
    !allowedProtocol ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new NotificationRuntimeError("INVALID_PUBLIC_ORIGIN");
  }
  return url.origin;
}

export function createNotificationDeepLinkIssuer(input: {
  readonly repository: AlertAccessRepository;
  readonly publicOrigin: string;
  readonly now?: () => Date;
  readonly randomBytes?: () => Uint8Array;
}): NotificationDeepLinkIssuer {
  const publicOrigin = normalizeNotificationPublicOrigin(input.publicOrigin);
  return Object.freeze({
    async issue(rawIds: Parameters<NotificationDeepLinkIssuer["issue"]>[0]) {
      const ids = DeepLinkIssueInputSchema.parse(rawIds);
      const grantInput: Parameters<typeof createAlertAccessGrant>[0] = {
        alertId: ids.alertId,
        eventId: ids.eventId,
        claimToken: ids.claimToken,
        expectedLeaseUntil: new Date(ids.expectedLeaseUntil),
        repository: input.repository,
        ...(input.now ? { now: input.now } : {}),
        ...(input.randomBytes ? { randomBytes: input.randomBytes } : {}),
      };
      const grant = await createAlertAccessGrant(grantInput);
      const url = new URL(`/alert/${ids.eventId}`, publicOrigin);
      url.searchParams.set("token", grant.token);
      return url.toString();
    },
  });
}

/**
 * Demo records live only for the duration of one worker run. Durable state and
 * cross-invocation idempotency remain in guardian_alerts through the leased
 * Supabase repository; no token or message body is persisted here.
 */
function createRunScopedDemoRepository(): DemoNotificationRepository {
  const records = new Map<string, DemoNotificationRecord>();
  return Object.freeze({
    async findByIdempotencyKey(key: string) {
      return records.get(key) ?? null;
    },
    async insertOnce(record: DemoNotificationRecord) {
      const existing = records.get(record.idempotencyKey);
      if (existing) return existing;
      records.set(record.idempotencyKey, record);
      return record;
    },
  });
}

export interface DemoNotificationRuntimeInput {
  readonly publicOrigin: string;
  readonly environment: {
    readonly NOTIFICATION_PROVIDER: unknown;
    readonly NOTIFICATION_LIVE_SEND_ENABLED: unknown;
  };
  readonly notificationRepository?: NotificationRepository;
  readonly alertAccessRepository?: AlertAccessRepository;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly randomBytes?: () => Uint8Array;
  readonly limit?: number;
}

/** Builds only the current no-network Demo runtime. Live provider modes fail closed. */
export async function runDemoNotificationRuntime(
  input: DemoNotificationRuntimeInput,
): Promise<DemoNotificationWorkerResult> {
  if (!DemoEnvironmentSchema.safeParse(input.environment).success) {
    throw new NotificationRuntimeError("UNSAFE_NOTIFICATION_MODE");
  }
  const publicOrigin = normalizeNotificationPublicOrigin(input.publicOrigin);
  const limit = WorkerLimitSchema.parse(input.limit ?? 20);

  let notificationRepository = input.notificationRepository;
  let alertAccessRepository = input.alertAccessRepository;
  if (!notificationRepository || !alertAccessRepository) {
    const client = createAdminSupabaseClient() as SupabaseClient;
    notificationRepository ??= createSupabaseNotificationRepository(
      client as unknown as NotificationRpcClient,
    );
    alertAccessRepository ??= createSupabaseAlertRepository(client);
  }

  const providerOptions: Parameters<typeof createDemoNotificationProvider>[0] = {
    repository: createRunScopedDemoRepository(),
    allowedOrigin: publicOrigin,
    ...(input.now ? { now: input.now } : {}),
  };

  const issuerOptions: Parameters<typeof createNotificationDeepLinkIssuer>[0] = {
    repository: alertAccessRepository,
    publicOrigin,
    ...(input.now ? { now: input.now } : {}),
    ...(input.randomBytes ? { randomBytes: input.randomBytes } : {}),
  };

  const workerInput: Parameters<typeof runDemoNotificationWorker>[0] = {
    repository: notificationRepository,
    provider: createDemoNotificationProvider(providerOptions),
    deepLinkIssuer: createNotificationDeepLinkIssuer(issuerOptions),
    limit,
    ...(input.now ? { now: input.now } : {}),
    ...(input.random ? { random: input.random } : {}),
  };
  return runDemoNotificationWorker(workerInput);
}
