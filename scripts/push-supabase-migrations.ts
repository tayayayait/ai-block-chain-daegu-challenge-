import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSupabasePushArgs,
  parseSupabaseDeployCli,
} from "../src/lib/supabase/deploy-policy.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linkedProjectPath = resolve(projectRoot, "supabase/.temp/project-ref");
const executable = resolve(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "supabase.exe" : "supabase",
);

function publicErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "COMPAT_DEPLOYMENT_NOT_CONFIRMED") {
    return "호환 앱 배포와 기존 인스턴스 종료를 확인한 뒤 운영 runbook의 확인값을 설정하세요.";
  }
  if (code === "UNEXPECTED_LINKED_PROJECT") {
    return "연결된 Supabase 프로젝트가 운영 대상과 다릅니다. project link를 다시 확인하세요.";
  }
  if (code === "SUPABASE_PROJECT_NOT_LINKED") {
    return "Supabase 프로젝트가 연결되지 않았습니다. 먼저 supabase link를 실행하세요.";
  }
  if (code === "SUPABASE_CLI_NOT_INSTALLED") {
    return "Supabase CLI가 없습니다. 잠금파일 기준으로 의존성을 설치하세요.";
  }
  if (code === "UNSUPPORTED_DEPLOY_ARGUMENT") {
    return "지원하지 않는 배포 인자입니다. --dry-run만 사용할 수 있습니다.";
  }
  return "Supabase migration 배포 준비를 확인하지 못했습니다.";
}

async function main(): Promise<void> {
  if (!existsSync(linkedProjectPath)) {
    throw new Error("SUPABASE_PROJECT_NOT_LINKED");
  }
  if (!existsSync(executable)) {
    throw new Error("SUPABASE_CLI_NOT_INSTALLED");
  }

  const { dryRun } = parseSupabaseDeployCli(process.argv.slice(2));
  const linkedProjectRef = readFileSync(linkedProjectPath, "utf8").trim();
  const args = buildSupabasePushArgs({
    dryRun,
    linkedProjectRef,
    compatibilityConfirmation: process.env["ONJUNG_COMPAT_DEPLOYMENT_DRAINED"],
  });

  process.exitCode = await new Promise<number>((resolveExit) => {
    const child = spawn(executable, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", () => resolveExit(1));
    child.once("exit", (code, signal) => resolveExit(signal ? 1 : (code ?? 1)));
  });
}

void main().catch((error: unknown) => {
  console.error(publicErrorMessage(error));
  process.exitCode = 1;
});
