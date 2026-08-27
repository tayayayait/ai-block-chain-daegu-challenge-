import { describe, expect, it } from "vitest";

import {
  buildSupabasePushArgs,
  parseSupabaseDeployCli,
  REQUIRED_COMPAT_DEPLOYMENT_CONFIRMATION,
  TARGET_SUPABASE_PROJECT_REF,
} from "./deploy-policy";

describe("production Supabase migration deploy policy", () => {
  it("builds a read-only dry run that can never include seed data", () => {
    const args = buildSupabasePushArgs({
      dryRun: true,
      linkedProjectRef: TARGET_SUPABASE_PROJECT_REF,
    });

    expect(args).toEqual(["db", "push", "--linked", "--dry-run"]);
    expect(args).not.toContain("--include-seed");
  });

  it("refuses a live push until the compatibility deployment has drained", () => {
    expect(() =>
      buildSupabasePushArgs({
        dryRun: false,
        linkedProjectRef: TARGET_SUPABASE_PROJECT_REF,
      }),
    ).toThrow(/COMPAT_DEPLOYMENT_NOT_CONFIRMED/u);
  });

  it("allows only a migration-only live push with the exact deployment confirmation", () => {
    const args = buildSupabasePushArgs({
      dryRun: false,
      linkedProjectRef: TARGET_SUPABASE_PROJECT_REF,
      compatibilityConfirmation: REQUIRED_COMPAT_DEPLOYMENT_CONFIRMATION,
    });

    expect(args).toEqual(["db", "push", "--linked"]);
    expect(args).not.toContain("--include-seed");
  });

  it("refuses a linked project other than the intended production project", () => {
    expect(() =>
      buildSupabasePushArgs({
        dryRun: true,
        linkedProjectRef: "another-project-ref",
      }),
    ).toThrow(/UNEXPECTED_LINKED_PROJECT/u);
  });

  it("accepts only an optional dry-run flag and rejects seed or passthrough arguments", () => {
    expect(parseSupabaseDeployCli([])).toEqual({ dryRun: false });
    expect(parseSupabaseDeployCli(["--dry-run"])).toEqual({ dryRun: true });
    expect(() => parseSupabaseDeployCli(["--include-seed"])).toThrow(
      /UNSUPPORTED_DEPLOY_ARGUMENT/u,
    );
    expect(() => parseSupabaseDeployCli(["--password", "secret"])).toThrow(
      /UNSUPPORTED_DEPLOY_ARGUMENT/u,
    );
  });
});
