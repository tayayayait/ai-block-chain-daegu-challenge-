import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_LOCAL_SECRET_NAMES = [
  "SUBJECT_HASH_SECRET",
  "REPORTER_HASH_SECRET",
  "CRON_SECRET",
] as const;

type RequiredLocalSecretName = (typeof REQUIRED_LOCAL_SECRET_NAMES)[number];

export interface LocalSecretGenerationResult {
  readonly envText: string;
  readonly generatedNames: readonly RequiredLocalSecretName[];
}

function isBlankEnvValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === '""' || trimmed === "''";
}

function uniqueSecret(generateSecret: () => string, existingValues: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const value = generateSecret();
    if (value.trim().length > 0 && !existingValues.has(value)) return value;
  }
  throw new Error("UNIQUE_SECRET_GENERATION_FAILED");
}

export function ensureLocalOperationalSecrets(
  envText: string,
  generateSecret: () => string = () => randomBytes(48).toString("base64url"),
): LocalSecretGenerationResult {
  const lineEnding = envText.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = envText.endsWith("\n");
  const lines = envText.split(/\r?\n/u);
  if (hadFinalNewline) lines.pop();

  const indexes = new Map<RequiredLocalSecretName, number>();
  const existingValues = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^(SUBJECT_HASH_SECRET|REPORTER_HASH_SECRET|CRON_SECRET)=(.*)$/u.exec(line);
    if (!match) continue;
    const name = match[1] as RequiredLocalSecretName;
    if (indexes.has(name)) throw new Error(`DUPLICATE_ENV_NAME:${name}`);
    indexes.set(name, index);
    const value = match[2] ?? "";
    if (!isBlankEnvValue(value)) existingValues.add(value.trim());
  }

  const generatedNames: RequiredLocalSecretName[] = [];
  for (const name of REQUIRED_LOCAL_SECRET_NAMES) {
    const index = indexes.get(name);
    if (index !== undefined) {
      const currentValue = (lines[index] ?? "").slice(name.length + 1);
      if (!isBlankEnvValue(currentValue)) continue;
    }

    const value = uniqueSecret(generateSecret, existingValues);
    existingValues.add(value);
    generatedNames.push(name);
    if (index === undefined) lines.push(`${name}=${value}`);
    else lines[index] = `${name}=${value}`;
  }

  if (generatedNames.length === 0) return { envText, generatedNames };
  return {
    envText: `${lines.join(lineEnding)}${hadFinalNewline ? lineEnding : ""}`,
    generatedNames,
  };
}

export async function generateLocalOperationalSecrets(envPath: string): Promise<readonly string[]> {
  const current = await readFile(envPath, "utf8");
  const result = ensureLocalOperationalSecrets(current);
  if (result.generatedNames.length > 0) {
    await writeFile(envPath, result.envText, { encoding: "utf8", mode: 0o600 });
  }
  return result.generatedNames;
}

async function main(): Promise<void> {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const generatedNames = await generateLocalOperationalSecrets(resolve(projectRoot, ".env"));
  if (generatedNames.length === 0) {
    console.log("Local operational server secrets are already configured.");
    return;
  }
  console.log(`Configured local-only server secrets: ${generatedNames.join(", ")}`);
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error(`Local secret generation failed: ${message}`);
    process.exitCode = 1;
  });
}
