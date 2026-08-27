import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vitestCli = resolve(projectRoot, "node_modules/vitest/vitest.mjs");
const liveTests = [
  "src/lib/home/live-summary.live.test.ts",
  "src/lib/medication/extraction/gemini.live.test.ts",
  "src/lib/medication/scan/providers.live.test.ts",
  "src/integrations/naver/geocode.live.test.ts",
  "src/integrations/tmap/tmap.live.test.ts",
];

const child = spawn(process.execPath, [vitestCli, "run", ...liveTests], {
  cwd: projectRoot,
  env: { ...process.env, LIVE_EXTERNAL_API_SMOKE: "1" },
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", (error) => {
  console.error(`Live API smoke runner failed: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Live API smoke runner stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
