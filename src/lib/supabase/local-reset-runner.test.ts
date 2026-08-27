import { describe, expect, it } from "vitest";

import {
  runLocalSupabaseReset,
  type LocalResetDependencies,
} from "../../../scripts/reset-local-supabase.ts";

const localStatus = JSON.stringify({
  DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
});

function createDependencies(
  run: LocalResetDependencies["run"] = (arguments_) =>
    arguments_[0] === "status" ? localStatus : "",
): LocalResetDependencies {
  return {
    readConfig: () => "[db]\nport = 54322\n",
    fixtureExists: () => true,
    run,
  };
}

describe("safe local Supabase reset runner", () => {
  it("verifies local status, resets without seed, then applies the fixed fixture", () => {
    const calls: Array<{ arguments_: readonly string[]; capture: boolean }> = [];
    runLocalSupabaseReset(
      [],
      createDependencies((arguments_, capture) => {
        calls.push({ arguments_, capture });
        return arguments_[0] === "status" ? localStatus : "";
      }),
    );

    expect(calls).toEqual([
      { arguments_: ["status", "--output", "json"], capture: true },
      { arguments_: ["db", "reset", "--local", "--no-seed"], capture: false },
      {
        arguments_: ["db", "query", "--local", "--file", "supabase/fixtures/local-demo.sql"],
        capture: false,
      },
    ]);
  });

  it("stops before reset when status points at a non-loopback database", () => {
    const calls: readonly string[][] = [];
    const dependencies = createDependencies((arguments_) => {
      (calls as string[][]).push([...arguments_]);
      return JSON.stringify({
        DB_URL: "postgresql://postgres:redacted@db.example.com:54322/postgres",
      });
    });

    expect(() => runLocalSupabaseReset([], dependencies)).toThrow(/loopback/u);
    expect(calls).toEqual([["status", "--output", "json"]]);
  });

  it("rejects command-line passthrough before any command runs", () => {
    let invoked = false;
    const dependencies = createDependencies(() => {
      invoked = true;
      return localStatus;
    });

    expect(() => runLocalSupabaseReset(["--linked"], dependencies)).toThrow(
      /인자를 받지 않습니다/u,
    );
    expect(invoked).toBe(false);
  });

  it("refuses to reset when the fixed fixture is missing", () => {
    const dependencies = { ...createDependencies(), fixtureExists: () => false };

    expect(() => runLocalSupabaseReset([], dependencies)).toThrow(/fixture/u);
  });
});
