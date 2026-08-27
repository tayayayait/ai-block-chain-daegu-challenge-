import { describe, expect, it, vi } from "vitest";

import {
  createDemoNotificationProvider,
  type DemoNotificationRecord,
} from "./demo-provider.server";

const input = {
  alertId: "123e4567-e89b-42d3-a456-426614174000",
  eventId: "123e4567-e89b-42d3-a456-426614174001",
  recipientRef: "a".repeat(64),
  channel: "SMS" as const,
  templateKey: "HEAT_L3" as const,
  riskLevel: "L3" as const,
  deepLink:
    "https://demo.onjung.example/alert/123e4567-e89b-42d3-a456-426614174001?token=opaque-secret-token",
  idempotencyKey: "subject:episode:L3:ENTER",
};

const createRepository = () => {
  const records = new Map<string, DemoNotificationRecord>();
  return {
    records,
    findByIdempotencyKey: async (key: string) => records.get(key) ?? null,
    insertOnce: async (record: DemoNotificationRecord) => {
      const existing = records.get(record.idempotencyKey);
      if (existing) return existing;
      records.set(record.idempotencyKey, record);
      return record;
    },
  };
};

describe("DemoNotificationProvider", () => {
  it("records exactly one deterministic demo result without calling any network", async () => {
    const repository = createRepository();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = createDemoNotificationProvider({
      repository,
      allowedOrigin: "https://demo.onjung.example",
      now: () => new Date("2026-08-23T12:00:00.000Z"),
    });

    const [first, second] = await Promise.all([
      provider.sendGuardianAlert(input),
      provider.sendGuardianAlert(input),
    ]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ kind: "demo-recorded" });
    expect(repository.records).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    const record = [...repository.records.values()][0];
    expect(record).toMatchObject({
      provider: "DEMO",
      status: "DEMO_RECORDED",
      deepLinkPath: "/alert/123e4567-e89b-42d3-a456-426614174001",
      sentAt: null,
      acceptedAt: null,
      deliveredAt: null,
    });
    expect(JSON.stringify(record)).not.toMatch(/opaque-secret-token|010-|demo\.onjung\.example/);
    fetchSpy.mockRestore();
  });

  it("rejects a foreign origin and an event/path mismatch without echoing the URL", async () => {
    const repository = createRepository();
    const provider = createDemoNotificationProvider({
      repository,
      allowedOrigin: "https://demo.onjung.example",
    });

    const foreign = await provider
      .sendGuardianAlert({ ...input, deepLink: input.deepLink.replace("demo.onjung", "evil") })
      .catch((error: unknown) => error);
    expect(foreign).toMatchObject({ code: "INVALID_DEEP_LINK" });
    expect(String(foreign)).not.toContain("evil");

    await expect(
      provider.sendGuardianAlert({
        ...input,
        deepLink:
          "https://demo.onjung.example/alert/123e4567-e89b-42d3-a456-426614174099?token=opaque",
      }),
    ).rejects.toMatchObject({ code: "INVALID_DEEP_LINK" });
  });
});
