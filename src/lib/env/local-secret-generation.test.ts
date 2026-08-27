import { describe, expect, it } from "vitest";

import { ensureLocalOperationalSecrets } from "../../../scripts/generate-local-secrets.ts";

describe("local operational secret generation", () => {
  it("fills only missing server secrets with distinct values without exposing them in metadata", () => {
    const generated = ["subject-secret", "reporter-secret", "cron-secret"];
    let index = 0;

    const result = ensureLocalOperationalSecrets(
      [
        "SUPABASE_URL=https://example.supabase.co",
        "SUBJECT_HASH_SECRET=",
        "REPORTER_HASH_SECRET=already-configured",
        "CRON_SECRET=",
        "",
      ].join("\n"),
      () => generated[index++] ?? "unexpected",
    );

    expect(result.envText).toContain("SUBJECT_HASH_SECRET=subject-secret");
    expect(result.envText).toContain("REPORTER_HASH_SECRET=already-configured");
    expect(result.envText).toContain("CRON_SECRET=reporter-secret");
    expect(result.generatedNames).toEqual(["SUBJECT_HASH_SECRET", "CRON_SECRET"]);
    expect(JSON.stringify(result.generatedNames)).not.toContain("subject-secret");
  });

  it("appends missing names and rejects duplicate declarations", () => {
    let index = 0;
    const result = ensureLocalOperationalSecrets(
      "SUPABASE_URL=https://example.supabase.co\n",
      () => `generated-${++index}`,
    );

    expect(result.envText).toContain("SUBJECT_HASH_SECRET=generated-1");
    expect(result.envText).toContain("REPORTER_HASH_SECRET=generated-2");
    expect(result.envText).toContain("CRON_SECRET=generated-3");

    expect(() =>
      ensureLocalOperationalSecrets("CRON_SECRET=one\nCRON_SECRET=two\n", () => "unused"),
    ).toThrow("DUPLICATE_ENV_NAME");
  });

  it("does not modify a fully configured environment", () => {
    const original = [
      "SUBJECT_HASH_SECRET=subject",
      "REPORTER_HASH_SECRET=reporter",
      "CRON_SECRET=cron",
      "",
    ].join("\n");

    const result = ensureLocalOperationalSecrets(original, () => {
      throw new Error("random generator must not run");
    });

    expect(result).toEqual({ envText: original, generatedNames: [] });
  });
});
