import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260824100000_phase7_notification_enqueue.sql"),
  "utf8",
);

describe("Phase 7 guardian notification enqueue migration", () => {
  it("queues an outbox row atomically from each inserted risk transition", () => {
    expect(migration).toMatch(/create or replace function private\.queue_guardian_alert/iu);
    expect(migration).toMatch(
      /create trigger alert_transitions_queue_guardian_alert[\s\S]*after insert on public\.alert_transitions/iu,
    );
    expect(migration).toMatch(/insert into public\.guardian_alerts/iu);
    expect(migration).toMatch(/on conflict \(idempotency_key\) do nothing/iu);
  });

  it("requires current consent, an enabled channel, and a recipient HMAC reference", () => {
    expect(migration).toMatch(/guardian_notification_preferences/iu);
    expect(migration).toMatch(/consented_at is not null/iu);
    expect(migration).toMatch(/withdrawn_at is null/iu);
    expect(migration).toMatch(/recipient_ref ~ '\^\[0-9a-f\]\{64\}\$'/iu);
    expect(migration).toMatch(/sms_enabled or notification_preference\.alimtalk_enabled/iu);
  });

  it("stores only a stable digest and a token-free event path", () => {
    expect(migration).toMatch(/extensions\.digest/iu);
    expect(migration).toMatch(/'\/alert\/' \|\| new\.id::text/iu);
    expect(migration).not.toMatch(/guardian_phone|subjects\.phone|\?token=/iu);
  });

  it("keeps the trigger private and inaccessible through the Data API", () => {
    expect(migration).toMatch(/revoke all on function private\.queue_guardian_alert\(\)/iu);
    expect(migration).not.toMatch(/grant execute[\s\S]*anon|grant execute[\s\S]*authenticated/iu);
  });
});
