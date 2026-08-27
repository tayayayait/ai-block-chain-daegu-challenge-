export interface VworldBuildingCliOptions {
  readonly sourceDirectory: string;
  readonly baseName: string;
  readonly mode: "check" | "write";
  readonly outputDirectory?: string;
}

export function parseVworldBuildingCliOptions(
  arguments_: readonly string[],
): VworldBuildingCliOptions {
  const values = new Map<string, string>();
  let mode: VworldBuildingCliOptions["mode"] | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--check" || argument === "--write") {
      if (mode) throw new Error("Choose exactly one of --check or --write");
      mode = argument === "--check" ? "check" : "write";
      continue;
    }
    if (!["--source-dir", "--base-name", "--output-dir"].includes(argument ?? "")) {
      throw new Error(`Unknown VWorld preparation argument: ${argument ?? ""}`);
    }
    const value = arguments_[index + 1];
    if (!argument || !value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument ?? "argument"}`);
    }
    if (values.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
    values.set(argument, value);
    index += 1;
  }

  const sourceDirectory = values.get("--source-dir");
  const baseName = values.get("--base-name");
  const outputDirectory = values.get("--output-dir");
  if (!sourceDirectory || !baseName || !mode) {
    throw new Error(
      "Usage: --source-dir <directory> --base-name <name> --check|--write [--output-dir <directory>]",
    );
  }
  if (mode === "write" && !outputDirectory) {
    throw new Error("--output-dir is required with --write");
  }
  return {
    sourceDirectory,
    baseName,
    mode,
    ...(outputDirectory ? { outputDirectory } : {}),
  };
}

async function runCli(arguments_: readonly string[]): Promise<void> {
  const options = parseVworldBuildingCliOptions(arguments_);
  if (options.mode === "check") {
    const audit = await scanVworldBuildingDataset(options);
    console.log(JSON.stringify(audit, null, 2));
    if (!audit.ok) throw new Error("VWorld source audit failed");
    return;
  }
  const bundle = await writeVworldBuildingBundle({
    ...options,
    outputDirectory: options.outputDirectory!,
  });
  console.log(
    JSON.stringify(
      {
        featurePath: bundle.featurePath,
        manifestPath: bundle.manifestPath,
        auditPath: bundle.auditPath,
        acceptedCount: bundle.audit.acceptedCount,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected VWorld preparation error";
    console.error(`VWorld building preparation failed: ${message}`);
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) void main();
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scanVworldBuildingDataset, writeVworldBuildingBundle } from "./vworld-building-source.ts";
