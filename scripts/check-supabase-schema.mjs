import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const executable = resolve(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "supabase.exe" : "supabase",
);

if (!existsSync(executable)) {
  throw new Error("Supabase CLI is missing. Run `bun install` first.");
}

const result = spawnSync(executable, ["db", "diff", "--local", "--schema", "public"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});

if (result.status !== 0) {
  throw new Error("Supabase schema diff failed. Start Docker and run `supabase start` first.");
}

if (result.stdout.trim()) {
  process.stderr.write(result.stdout);
  throw new Error("Local database differs from the committed Supabase migrations.");
}

process.stdout.write("Local database matches the committed migrations.\n");
