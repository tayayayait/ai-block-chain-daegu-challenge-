#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scannedExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".mjs"]);
const maximumFileBytes = 25 * 1024 * 1024;
const forbiddenMarkers = [
  ["NODE_CRYPTO", /(?:node:crypto|__vite-browser-external)/u],
  [
    "SERVER_ENV_NAME",
    /\b(?:SUPABASE_SECRET_KEY|NAVER_MAPS_CLIENT_SECRET|TMAP_APP_KEY|GEMINI_API_KEY|KMA_APIHUB_AUTH_KEY|EAS_ATTESTER_PRIVATE_KEY|SUBJECT_HASH_SECRET|REPORTER_HASH_SECRET)\b/u,
  ],
  ["SERVER_PACKAGE", /(?:@google\/genai|@ethereum-attestation-service\/eas-sdk)/u],
  ["SUPABASE_SECRET_KEY", /\bsb_secret_[A-Za-z0-9_-]{20,}\b/u],
  ["KOREAN_PHONE", /\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b/u],
  ["KOREAN_RESIDENT_ID", /\b\d{6}-[1-4]\d{6}\b/u],
];

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile() && scannedExtensions.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files;
}

export async function verifyClientBundle(staticDirectory) {
  const root = resolve(staticDirectory);
  const files = await filesUnder(root);
  for (const path of files) {
    const displayPath = relative(root, path).replaceAll("\\", "/");
    if ((await stat(path)).size > maximumFileBytes) {
      throw new Error(`Client bundle verification skipped oversized file: ${displayPath}`);
    }
    const source = await readFile(path, "utf8");
    for (const [kind, pattern] of forbiddenMarkers) {
      if (pattern.test(source)) {
        throw new Error(`Client bundle contains forbidden marker ${kind}: ${displayPath}`);
      }
    }
  }
  return Object.freeze({ filesScanned: files.length });
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntry === fileURLToPath(import.meta.url)) {
  const staticDirectory = resolve(process.argv[2] ?? ".vercel/output/static");
  const result = await verifyClientBundle(staticDirectory);
  process.stdout.write(`Client bundle verified (${result.filesScanned} files).\n`);
}
