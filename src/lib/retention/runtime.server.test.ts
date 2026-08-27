import { describe, expect, it } from "vitest";

import { isRetentionCronAuthorized } from "./runtime.server";

describe("retention cron authorization", () => {
  const secret = "retention-cron-fixture-secret";

  it("accepts only an exact sufficiently long bearer secret", () => {
    expect(isRetentionCronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(isRetentionCronAuthorized("Bearer wrong", secret)).toBe(false);
    expect(isRetentionCronAuthorized(null, secret)).toBe(false);
    expect(isRetentionCronAuthorized("Bearer short", "short")).toBe(false);
  });
});
