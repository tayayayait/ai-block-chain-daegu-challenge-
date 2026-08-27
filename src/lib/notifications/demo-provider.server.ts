import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";

import {
  GuardianAlertInputSchema,
  type NotificationProvider,
  type SendGuardianAlertInput,
} from "./provider";

export interface DemoNotificationRecord {
  alertId: string;
  eventId: string;
  recipientRef: string;
  provider: "DEMO";
  channel: "SMS" | "ALIMTALK";
  templateKey: "HEAT_L3" | "HEAT_L4";
  riskLevel: "L3" | "L4";
  status: "DEMO_RECORDED";
  providerMessageId: string;
  payloadDigest: string;
  deepLinkPath: string;
  idempotencyKey: string;
  attemptCount: number;
  recordedAt: string;
  sentAt: null;
  acceptedAt: null;
  deliveredAt: null;
}

export interface DemoNotificationRepository {
  findByIdempotencyKey(key: string): Promise<DemoNotificationRecord | null>;
  insertOnce(record: DemoNotificationRecord): Promise<DemoNotificationRecord>;
}

export class DemoNotificationError extends Error {
  readonly code: "INVALID_INPUT" | "INVALID_DEEP_LINK";

  constructor(code: "INVALID_INPUT" | "INVALID_DEEP_LINK") {
    super(`Demo notification rejected: ${code}`);
    this.name = "DemoNotificationError";
    this.code = code;
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const safeDeepLinkPath = (input: SendGuardianAlertInput, allowedOrigin: string): string => {
  let deepLink: URL;
  try {
    deepLink = new URL(input.deepLink);
  } catch {
    throw new DemoNotificationError("INVALID_DEEP_LINK");
  }
  const expectedPath = `/alert/${input.eventId}`;
  if (
    deepLink.origin !== allowedOrigin ||
    deepLink.pathname !== expectedPath ||
    !deepLink.searchParams.get("token") ||
    deepLink.hash
  ) {
    throw new DemoNotificationError("INVALID_DEEP_LINK");
  }
  return expectedPath;
};

export const createDemoNotificationProvider = (options: {
  repository: DemoNotificationRepository;
  allowedOrigin: string;
  now?: () => Date;
}): NotificationProvider => {
  const allowedOrigin = new URL(options.allowedOrigin).origin;
  const now = options.now ?? (() => new Date());

  return {
    async sendGuardianAlert(untrustedInput) {
      const parsed = GuardianAlertInputSchema.safeParse(untrustedInput);
      if (!parsed.success) throw new DemoNotificationError("INVALID_INPUT");
      const input = parsed.data;
      const existing = await options.repository.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        return {
          kind: "demo-recorded",
          providerMessageId: existing.providerMessageId,
          recordedAt: existing.recordedAt,
        };
      }

      const deepLinkPath = safeDeepLinkPath(input, allowedOrigin);
      const recordedAt = now().toISOString();
      const providerMessageId = `demo_${sha256(input.idempotencyKey)}`;
      const payloadDigest = sha256(
        JSON.stringify({
          alertId: input.alertId,
          eventId: input.eventId,
          recipientRef: input.recipientRef,
          channel: input.channel,
          templateKey: input.templateKey,
          riskLevel: input.riskLevel,
          deepLinkPath,
          idempotencyKey: input.idempotencyKey,
        }),
      );
      const saved = await options.repository.insertOnce({
        alertId: input.alertId,
        eventId: input.eventId,
        recipientRef: input.recipientRef,
        provider: "DEMO",
        channel: input.channel,
        templateKey: input.templateKey,
        riskLevel: input.riskLevel,
        status: "DEMO_RECORDED",
        providerMessageId,
        payloadDigest,
        deepLinkPath,
        idempotencyKey: input.idempotencyKey,
        attemptCount: 1,
        recordedAt,
        sentAt: null,
        acceptedAt: null,
        deliveredAt: null,
      });

      return {
        kind: "demo-recorded",
        providerMessageId: saved.providerMessageId,
        recordedAt: saved.recordedAt,
      };
    },
  };
};
