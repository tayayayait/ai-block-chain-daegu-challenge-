#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());
const scannerPath = resolve(import.meta.filename);
const skippedDirectories = new Set([
  ".git",
  ".output",
  ".tanstack",
  ".vite",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function shouldSkipDirectory(path, name) {
  if (skippedDirectories.has(name)) return true;
  return /(?:^|\/)\.vercel\/output\/functions\/[^/]+\/_libs$/u.test(portablePath(path));
}
const scannedExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".map",
  ".md",
  ".mjs",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const namedSecret =
  /\b([A-Z][A-Z0-9_]*(?:API_KEY|APP_KEY|AUTH_KEY|CLIENT_SECRET|SERVICE_ROLE_KEY|SECRET_KEY|PRIVATE_KEY|PASSWORD|ACCESS_TOKEN|SECRET))\b\s*[:=]\s*(["'`])([^"'`\r\n]+)\2/g;
const envSecret =
  /^\s*([A-Z][A-Z0-9_]*(?:API_KEY|APP_KEY|AUTH_KEY|CLIENT_SECRET|SERVICE_ROLE_KEY|SECRET_KEY|PRIVATE_KEY|PASSWORD|ACCESS_TOKEN|SECRET))\s*=\s*(.*?)\s*$/;
const jwt = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}\b/g;
const providerPatterns = [
  ["OPENAI_API_KEY", /\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{32,}\b/g],
  ["GOOGLE_API_KEY", /\bAIza[A-Za-z0-9_-]{30,}\b/g],
  ["GITHUB_TOKEN", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ["AWS_ACCESS_KEY", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["SUPABASE_SECRET_KEY", /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g],
];
const piiPatterns = [
  ["KOREAN_PHONE", /\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b/g],
  ["KOREAN_RESIDENT_ID", /\b\d{6}-[1-4]\d{6}\b/g],
];
const allowMarker = /^\s*\/\/\s*secret-scan:\s*allow-next-line\s+--\s+test-fixture\s*$/;

/** @type {{ path: string, line: number, kind: string }[]} */
const findings = [];

function portablePath(path) {
  const result = relative(root, path).replaceAll("\\", "/");
  return result || basename(path);
}

function isLocalEnvironmentFile(path) {
  const name = basename(path).toLowerCase();
  if (!name.startsWith(".env")) return false;
  return !/(?:example|sample|template)$/.test(name);
}

function shouldScan(path) {
  if (resolve(path) === scannerPath || isLocalEnvironmentFile(path)) return false;
  const name = basename(path).toLowerCase();
  if (/^\.env\.(?:example|sample|template)$/.test(name)) return true;
  return scannedExtensions.has(extname(name));
}

function isTestFile(path) {
  const normalized = portablePath(path).toLowerCase();
  return (
    /(?:^|\/)(?:test|tests|__tests__|fixtures)(?:\/|$)/.test(normalized) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
  );
}

function isControlledFixtureFile(path) {
  return isTestFile(path) || portablePath(path) === "scripts/generate-supabase-seed.ts";
}

function isPlaceholder(value) {
  const normalized = value.trim();
  return (
    normalized === "" ||
    normalized === "null" ||
    normalized === "undefined" ||
    normalized.startsWith("${") ||
    normalized.startsWith("<") ||
    /^(?:replace|change)[-_ ]?me$/i.test(normalized) ||
    /^(?:your|example|placeholder)[-_ ]/i.test(normalized) ||
    /^(?:process|import\.meta)\.env\b/.test(normalized)
  );
}

function addFinding(path, line, kind, allowed) {
  if (allowed) return;
  if (!findings.some((item) => item.path === path && item.line === line && item.kind === kind)) {
    findings.push({ path, line, kind });
  }
}

function classifyJwt(value) {
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
    if (payload?.iss === "supabase" && payload?.role === "anon" && payload?.ref) return null;
    return payload?.role === "service_role" ? "JWT_SERVICE_ROLE" : "JWT_TOKEN";
  } catch {
    return "JWT_TOKEN";
  }
}

function scanFile(path) {
  let source;
  try {
    if (statSync(path).size > 25 * 1024 * 1024) {
      findings.push({ path: portablePath(path), line: 0, kind: "SCAN_FILE_TOO_LARGE" });
      return;
    }
    source = readFileSync(path, "utf8");
  } catch {
    findings.push({ path: portablePath(path), line: 0, kind: "SCAN_IO_ERROR" });
    return;
  }

  const displayPath = portablePath(path);
  const lines = source.split(/\r?\n/);
  const fixtureFile = isControlledFixtureFile(path);
  const scanPii = !fixtureFile && extname(path).toLowerCase() !== ".md";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const allowed = fixtureFile && index > 0 && allowMarker.test(lines[index - 1]);

    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(line)) {
      addFinding(displayPath, index + 1, "PRIVATE_KEY", allowed);
    }

    for (const match of line.matchAll(jwt)) {
      const kind = classifyJwt(match[0]);
      if (kind) addFinding(displayPath, index + 1, kind, allowed);
    }

    for (const [kind, pattern] of providerPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) addFinding(displayPath, index + 1, kind, allowed);
    }

    if (scanPii) {
      for (const [kind, pattern] of piiPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) addFinding(displayPath, index + 1, kind, false);
      }
    }

    namedSecret.lastIndex = 0;
    for (const match of line.matchAll(namedSecret)) {
      if (!isPlaceholder(match[3])) {
        addFinding(displayPath, index + 1, "NAMED_SECRET_LITERAL", allowed);
      }
    }

    if (/^\.env\.(?:example|sample|template)$/i.test(basename(path))) {
      const match = line.match(envSecret);
      if (match && !isPlaceholder(match[2])) {
        addFinding(displayPath, index + 1, "NAMED_SECRET_ASSIGNMENT", false);
      }
    }
  }
}

function walk(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    findings.push({ path: portablePath(directory), line: 0, kind: "SCAN_IO_ERROR" });
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(path, entry.name)) walk(path);
    } else if (entry.isFile() && shouldScan(path)) {
      scanFile(path);
    }
  }
}

walk(root);
findings.sort(
  (left, right) =>
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.kind.localeCompare(right.kind),
);

if (findings.length > 0) {
  process.stderr.write(`Secret scan failed: ${findings.length} potential finding(s).\n`);
  for (const finding of findings) {
    process.stderr.write(`${finding.path}:${finding.line} [${finding.kind}]\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write("Secret scan passed.\n");
}
