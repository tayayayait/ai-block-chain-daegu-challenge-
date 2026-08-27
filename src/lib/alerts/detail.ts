import { z } from "zod";

const PHONE_LIKE = /01[016789][\s-]?\d{3,4}[\s-]?\d{4}/u;
const UUID_LIKE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;

export const AlertReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((reason) => !PHONE_LIKE.test(reason) && !UUID_LIKE.test(reason), {
    message: "alert reasons cannot contain private identifiers",
  });

export const AlertDetailDtoSchema = z
  .object({
    eventId: z.string().uuid(),
    maskedName: z.string().trim().min(1).max(20),
    riskLevel: z.enum(["L3", "L4"]),
    hri: z.number().int().min(0).max(100),
    occurredAt: z.string().datetime({ offset: true }),
    reasons: z.array(AlertReasonSchema).min(1).max(3),
    demo: z.literal(true),
  })
  .strict();

export type AlertDetailDto = z.infer<typeof AlertDetailDtoSchema>;
