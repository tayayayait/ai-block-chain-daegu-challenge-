import "@tanstack/react-start/server-only";

import { timingSafeEqual } from "node:crypto";

export const NOTIFICATION_CRON_SECRET_MIN_LENGTH = 16;

/** Constant-time comparison for the notification worker Bearer secret. */
export function isNotificationCronAuthorized(
  authorizationHeader: string | null | undefined,
  cronSecret: string,
): boolean {
  if (
    !authorizationHeader?.startsWith("Bearer ") ||
    cronSecret.length < NOTIFICATION_CRON_SECRET_MIN_LENGTH
  ) {
    return false;
  }
  const provided = Buffer.from(authorizationHeader.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(cronSecret, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
