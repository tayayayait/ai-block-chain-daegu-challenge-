import { describe, expect, it } from "vitest";

import {
  assertLoopbackDatabaseUrl,
  buildLocalFixtureQueryArgs,
  buildLocalResetArgs,
  parseLocalDatabasePort,
  parseResetCliArguments,
  parseStatusDatabaseUrl,
} from "./local-reset-policy.ts";

describe("local Supabase reset policy", () => {
  it("accepts no wrapper arguments and rejects every passthrough argument", () => {
    expect(parseResetCliArguments([])).toEqual([]);
    expect(() => parseResetCliArguments(["--linked"])).toThrow(/인자를 받지 않습니다/u);
    expect(() => parseResetCliArguments(["--db-url", "postgresql://remote"])).toThrow(
      /인자를 받지 않습니다/u,
    );
  });

  it("builds the one allowed destructive reset command", () => {
    expect(buildLocalResetArgs()).toEqual(["db", "reset", "--local", "--no-seed"]);
  });

  it("extracts and bounds the configured local database port", () => {
    expect(parseLocalDatabasePort("[db]\nport = 54322\n")).toBe(54322);
    expect(() => parseLocalDatabasePort("[db]\nport = 80\n")).toThrow(/port/u);
    expect(() => parseLocalDatabasePort("[db.pooler]\nport = 54329\n")).toThrow(/\[db\]/u);
  });

  it("reads the DB URL from status JSON without logging other credentials", () => {
    expect(
      parseStatusDatabaseUrl(
        JSON.stringify({ DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" }),
      ),
    ).toBe("postgresql://postgres:postgres@127.0.0.1:54322/postgres");
    expect(() => parseStatusDatabaseUrl('{"ANON_KEY":"redacted"}')).toThrow(/DB URL/u);
  });

  it("accepts only a loopback database URL on the configured port", () => {
    expect(() =>
      assertLoopbackDatabaseUrl("postgresql://postgres:postgres@127.0.0.1:54322/postgres", 54322),
    ).not.toThrow();
    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@db.example.com:54322/postgres",
        54322,
      ),
    ).toThrow(/loopback/u);
    expect(() =>
      assertLoopbackDatabaseUrl("postgresql://postgres:postgres@127.0.0.1:54323/postgres", 54322),
    ).toThrow(/port/u);
  });

  it("applies the fixture through the local selector and a fixed file", () => {
    expect(buildLocalFixtureQueryArgs()).toEqual([
      "db",
      "query",
      "--local",
      "--file",
      "supabase/fixtures/local-demo.sql",
    ]);
  });
});
