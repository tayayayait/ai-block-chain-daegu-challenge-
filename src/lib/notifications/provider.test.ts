import { describe, expect, it } from "vitest";

import { GuardianAlertInputSchema } from "./provider";

const valid = {
  alertId: "123e4567-e89b-42d3-a456-426614174000",
  eventId: "123e4567-e89b-42d3-a456-426614174001",
  recipientRef: "a".repeat(64),
  channel: "SMS",
  templateKey: "HEAT_L3",
  riskLevel: "L3",
  deepLink: "https://demo.onjung.example/alert/123e4567-e89b-42d3-a456-426614174001?token=opaque",
  idempotencyKey: "subject:episode:L3:ENTER",
} as const;

describe("NotificationProvider contract", () => {
  it("accepts the minimal L3/L4 guardian alert boundary", () => {
    expect(GuardianAlertInputSchema.parse(valid)).toEqual(valid);
    expect(
      GuardianAlertInputSchema.parse({ ...valid, templateKey: "HEAT_L4", riskLevel: "L4" }),
    ).toBeDefined();
  });

  it("rejects template/risk mismatches and raw phone-shaped recipient values", () => {
    expect(GuardianAlertInputSchema.safeParse({ ...valid, templateKey: "HEAT_L4" }).success).toBe(
      false,
    );
    expect(
      GuardianAlertInputSchema.safeParse({ ...valid, recipientRef: "010-1234-5678" }).success,
    ).toBe(false);
  });
});
