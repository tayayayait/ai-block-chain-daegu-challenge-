import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverUrl = "http://127.0.0.1:4173";
const viteCli = resolve(projectRoot, "node_modules/vite/bin/vite.js");
const playwrightCli = resolve(projectRoot, "node_modules/@playwright/test/cli.js");

async function isServerAvailable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(serverUrl, { signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function startServer() {
  return spawn(
    process.execPath,
    [viteCli, "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
    {
      cwd: projectRoot,
      detached: process.platform !== "win32",
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    },
  );
}

async function waitForServer(server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isServerAvailable()) return;
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready (exit ${server.exitCode}).`);
    }
    await delay(250);
  }
  throw new Error("Vite did not become ready within 120 seconds.");
}

function runPlaywright(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [playwrightCli, "test", ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`Playwright stopped by ${signal}.`));
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    delay(timeoutMs),
  ]);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;

  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/pid", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.status !== 0 && server.exitCode === null) server.kill("SIGKILL");
  } else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }

  await waitForExit(server, 3_000);
  if (server.exitCode !== null) return;

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
  await waitForExit(server, 1_000);
}

let ownedServer;
let stopping = false;

async function stopForSignal(exitCode) {
  if (stopping) return;
  stopping = true;
  await stopServer(ownedServer);
  process.exit(exitCode);
}

process.once("SIGINT", () => void stopForSignal(130));
process.once("SIGTERM", () => void stopForSignal(143));

try {
  if (!(await isServerAvailable())) {
    ownedServer = startServer();
    await waitForServer(ownedServer);
  }
  process.exitCode = await runPlaywright(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown E2E runner failure.";
  console.error(`E2E runner failed: ${message}`);
  process.exitCode = 1;
} finally {
  await stopServer(ownedServer);
}
