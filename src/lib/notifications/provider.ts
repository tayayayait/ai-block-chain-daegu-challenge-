import { z } from "zod";

export const GuardianAlertInputSchema = z
  .object({
    alertId: z.string().uuid(),
    eventId: z.string().uuid(),
    recipientRef: z.string().regex(/^[0-9a-f]{64}$/),
    channel: z.enum(["SMS", "ALIMTALK"]),
    templateKey: z.enum(["HEAT_L3", "HEAT_L4"]),
    riskLevel: z.enum(["L3", "L4"]),
    deepLink: z.string().url().max(2_048),
    idempotencyKey: z.string().trim().min(1).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.templateKey !== `HEAT_${value.riskLevel}`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["templateKey"],
        message: "template and risk level must match",
      });
    }
  });

export type SendGuardianAlertInput = z.infer<typeof GuardianAlertInputSchema>;

export type SendGuardianAlertResult =
  | Readonly<{ kind: "demo-recorded"; providerMessageId: string; recordedAt: string }>
  | Readonly<{ kind: "accepted"; providerMessageId: string; acceptedAt: string }>
  | Readonly<{ kind: "retryable-failure"; code: string; retryAfterSeconds?: number }>
  | Readonly<{ kind: "permanent-failure"; code: string }>;

export interface NotificationProvider {
  sendGuardianAlert(input: SendGuardianAlertInput): Promise<SendGuardianAlertResult>;
}
