import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertLoopbackDatabaseUrl,
  buildLocalFixtureQueryArgs,
  buildLocalResetArgs,
  parseLocalDatabasePort,
  parseResetCliArguments,
  parseStatusDatabaseUrl,
} from "../src/lib/supabase/local-reset-policy.ts";

export interface LocalResetDependencies {
  readonly readConfig: () => string;
  readonly fixtureExists: () => boolean;
  readonly run: (arguments_: readonly string[], capture: boolean) => string;
}

export function runLocalSupabaseReset(
  arguments_: readonly string[],
  dependencies: LocalResetDependencies,
): void {
  parseResetCliArguments(arguments_);
  if (!dependencies.fixtureExists()) {
    throw new Error("로컬 Demo fixture가 없습니다.");
  }

  const expectedPort = parseLocalDatabasePort(dependencies.readConfig());
  const statusJson = dependencies.run(["status", "--output", "json"], true);
  const databaseUrl = parseStatusDatabaseUrl(statusJson);
  assertLoopbackDatabaseUrl(databaseUrl, expectedPort);

  dependencies.run(buildLocalResetArgs(), false);
  dependencies.run(buildLocalFixtureQueryArgs(), false);
}

function createProductionDependencies(projectRoot: string): LocalResetDependencies {
  const cliPath = resolve(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "supabase.exe" : "supabase",
  );
  const configPath = resolve(projectRoot, "supabase", "config.toml");
  const fixturePath = resolve(projectRoot, "supabase", "fixtures", "local-demo.sql");
  if (!existsSync(cliPath)) {
    throw new Error("프로젝트 로컬 Supabase CLI 실행 파일이 없습니다.");
  }

  return {
    readConfig: () => readFileSync(configPath, "utf8"),
    fixtureExists: () => existsSync(fixturePath),
    run: (arguments_, capture) => {
      const result = spawnSync(cliPath, [...arguments_], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      });
      if (result.error || result.status !== 0) {
        const operation = arguments_[0] === "status" ? "상태 확인" : "로컬 DB 작업";
        throw new Error(`Supabase ${operation}에 실패했습니다.`);
      }
      return capture && typeof result.stdout === "string" ? result.stdout : "";
    },
  };
}

function main(): void {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(scriptDirectory, "..");
  try {
    runLocalSupabaseReset(process.argv.slice(2), createProductionDependencies(projectRoot));
    console.log("로컬 Supabase migration과 Demo fixture 적용이 완료되었습니다.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    console.error(`로컬 Supabase reset 실패: ${message}`);
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) {
  main();
}
