import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const executable = resolve(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "supabase.exe" : "supabase",
);
const outputPath = resolve(root, "src/lib/supabase/database.types.ts");
const checkOnly = process.argv.includes("--check");

if (!existsSync(executable)) {
  throw new Error("Supabase CLI is missing. Run `bun install` first.");
}

const result = spawnSync(executable, ["gen", "types", "typescript", "--local"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});

if (result.status !== 0) {
  throw new Error("Supabase type generation failed. Start Docker and run `supabase start` first.");
}

const generated = `${result.stdout.trimEnd()}\n`;
if (!generated.includes("export type Database")) {
  throw new Error("Supabase CLI returned an unexpected type payload.");
}

if (checkOnly) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== generated) {
    throw new Error(
      "Supabase database types are stale. Run `bun run supabase:types` after applying migrations.",
    );
  }
  process.stdout.write("Supabase database types match the local schema.\n");
} else {
  writeFileSync(outputPath, generated, "utf8");
  process.stdout.write("Generated src/lib/supabase/database.types.ts.\n");
}
