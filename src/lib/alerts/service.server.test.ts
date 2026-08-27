import { describe, expect, it } from "vitest";

import { loadGuardianAlertDetail, type AlertDetailRepository } from "./service.server";

const ALERT_ID = "123e4567-e89b-42d3-a456-426614174000";
const EVENT_ID = "123e4567-e89b-42d3-a456-426614174001";
const SUBJECT_ID = "123e4567-e89b-42d3-a456-426614174002";

const validRecord = {
  alertId: ALERT_ID,
  eventId: EVENT_ID,
  subjectId: SUBJECT_ID,
  subjectName: "김온중",
  riskLevel: "L4",
  hri: 82,
  occurredAt: "2026-08-23T12:00:00.000Z",
  reasons: ["체감 39.2℃ + 폭염경보 (+31)", "폭염 주의 의약품 고위험 1계열 복용 (+20)"],
} as const;

const repositoryWith = (record: unknown): AlertDetailRepository => ({
  findByAccess: async () => record as never,
});

describe("guardian alert detail service", () => {
  it("returns only a strict masked action DTO for the matching session grant", async () => {
    const result = await loadGuardianAlertDetail(
      { alertId: ALERT_ID, eventId: EVENT_ID },
      repositoryWith(validRecord),
    );

    expect(result).toEqual({
      kind: "READY",
      detail: {
        eventId: EVENT_ID,
        maskedName: "김○○",
        riskLevel: "L4",
        hri: 82,
        occurredAt: "2026-08-23T12:00:00.000Z",
        reasons: validRecord.reasons,
        demo: true,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      new RegExp(`${SUBJECT_ID}|김온중|address|phone|guardian`, "iu"),
    );
  });

  it.each([
    null,
    { ...validRecord, alertId: "123e4567-e89b-42d3-a456-426614174099" },
    { ...validRecord, eventId: "123e4567-e89b-42d3-a456-426614174099" },
    { ...validRecord, riskLevel: "L2" },
    { ...validRecord, reasons: [...validRecord.reasons, "세 번째", "네 번째"] },
    { ...validRecord, reasons: ["보호자 연락처 010-1234-5678"] },
    { ...validRecord, phone: "010-1234-5678" },
  ])("fails closed without returning diagnostics for invalid record %#", async (record) => {
    await expect(
      loadGuardianAlertDetail({ alertId: ALERT_ID, eventId: EVENT_ID }, repositoryWith(record)),
    ).resolves.toEqual({ kind: "UNAVAILABLE" });
  });

  it("converts repository failures to the same non-sensitive unavailable result", async () => {
    const repository: AlertDetailRepository = {
      findByAccess: async () => {
        throw new Error("subject phone 010-1234-5678 token=private");
      },
    };

    await expect(
      loadGuardianAlertDetail({ alertId: ALERT_ID, eventId: EVENT_ID }, repository),
    ).resolves.toEqual({ kind: "UNAVAILABLE" });
  });
});
