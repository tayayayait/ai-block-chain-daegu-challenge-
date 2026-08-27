import "@tanstack/react-start/server-only";

import { z } from "zod";

import { maskSubjectName } from "@/lib/subjects/dto";

import { AlertDetailDtoSchema, AlertReasonSchema, type AlertDetailDto } from "./detail";

const AlertAccessSchema = z
  .object({
    alertId: z.string().uuid(),
    eventId: z.string().uuid(),
  })
  .strict();

export const AlertDetailRecordSchema = z
  .object({
    alertId: z.string().uuid(),
    eventId: z.string().uuid(),
    subjectId: z.string().uuid(),
    subjectName: z.string().trim().min(1).max(80),
    riskLevel: z.enum(["L3", "L4"]),
    hri: z.number().int().min(0).max(100),
    occurredAt: z.string().datetime({ offset: true }),
    reasons: z.array(AlertReasonSchema).min(1).max(3),
  })
  .strict();

export type AlertDetailRecord = z.infer<typeof AlertDetailRecordSchema>;

export interface AlertDetailRepository {
  findByAccess(input: { alertId: string; eventId: string }): Promise<AlertDetailRecord | null>;
}

export type GuardianAlertDetailResult =
  Readonly<{ kind: "READY"; detail: AlertDetailDto }> | Readonly<{ kind: "UNAVAILABLE" }>;

/**
 * Maps trusted storage rows into the complete and deliberately minimal S-08
 * response. Every storage or shape failure is indistinguishable to callers.
 */
export async function loadGuardianAlertDetail(
  rawAccess: unknown,
  repository: AlertDetailRepository,
): Promise<GuardianAlertDetailResult> {
  const access = AlertAccessSchema.safeParse(rawAccess);
  if (!access.success) return { kind: "UNAVAILABLE" };

  try {
    const rawRecord = await repository.findByAccess(access.data);
    const record = AlertDetailRecordSchema.safeParse(rawRecord);
    if (
      !record.success ||
      record.data.alertId !== access.data.alertId ||
      record.data.eventId !== access.data.eventId ||
      record.data.reasons.some((reason) => reason.includes(record.data.subjectName.trim()))
    ) {
      return { kind: "UNAVAILABLE" };
    }

    const detail = AlertDetailDtoSchema.safeParse({
      eventId: record.data.eventId,
      maskedName: maskSubjectName(record.data.subjectName),
      riskLevel: record.data.riskLevel,
      hri: record.data.hri,
      occurredAt: record.data.occurredAt,
      reasons: record.data.reasons,
      demo: true,
    });
    if (!detail.success) return { kind: "UNAVAILABLE" };

    return { kind: "READY", detail: Object.freeze(detail.data) };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}
