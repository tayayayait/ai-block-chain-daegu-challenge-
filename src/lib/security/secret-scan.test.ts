import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const scannerPath = resolve(process.cwd(), "scripts/secret-scan.mjs");
const temporaryRoots: string[] = [];

function makeWorkspace(): string {
  const root = mkdtempSync(resolve(tmpdir(), "onjung-secret-scan-"));
  temporaryRoots.push(root);
  mkdirSync(resolve(root, "src"), { recursive: true });
  return root;
}

function runScanner(root: string) {
  return spawnSync(process.execPath, [scannerPath, root], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release secret scanner", () => {
  it("finds source and build-output secrets without printing their values", () => {
    const root = makeWorkspace();
    mkdirSync(resolve(root, "dist/assets"), { recursive: true });
    const jwt = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ role: "service_role", ref: "fake-project" })).toString(
        "base64url",
      ),
      "f".repeat(43),
    ].join(".");
    const providerKey = `sk-${"f".repeat(40)}`;

    writeFileSync(resolve(root, "src/server.ts"), `export const token = "${jwt}";\n`);
    writeFileSync(resolve(root, "dist/assets/app.js"), `const providerKey = "${providerKey}";\n`);

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/server.ts:1 [JWT_SERVICE_ROLE]");
    expect(result.stderr).toContain("dist/assets/app.js:1 [OPENAI_API_KEY]");
    expect(result.stderr).not.toContain(jwt);
    expect(result.stderr).not.toContain(providerKey);
  });

  it("detects named literals and private keys while redacting every finding", () => {
    const root = makeWorkspace();
    const namedSecret = `fake_${"x".repeat(48)}`;
    const pemBody = "Z".repeat(64);
    writeFileSync(
      resolve(root, "src/config.ts"),
      [
        `const TMAP_API_KEY = "${namedSecret}";`,
        // secret-scan: allow-next-line -- test-fixture
        "-----BEGIN PRIVATE KEY-----",
        pemBody,
        "-----END PRIVATE KEY-----",
      ].join("\n"),
    );

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/config.ts:1 [NAMED_SECRET_LITERAL]");
    expect(result.stderr).toContain("src/config.ts:2 [PRIVATE_KEY]");
    expect(result.stderr).not.toContain(namedSecret);
    expect(result.stderr).not.toContain(pemBody);
  });

  it("allows only an immediately marked fake fixture in a test file", () => {
    const root = makeWorkspace();
    const fakeKey = `sk-${"t".repeat(40)}`;
    writeFileSync(
      resolve(root, "src/provider.test.ts"),
      [
        "// secret-scan: allow-next-line -- test-fixture",
        `const deliberatelyFakeFixture = "${fakeKey}";`,
      ].join("\n"),
    );
    writeFileSync(
      resolve(root, ".env.example"),
      // secret-scan: allow-next-line -- test-fixture
      ["SUPABASE_SERVICE_ROLE_KEY=", "GEMINI_API_KEY=", "TMAP_APP_KEY="].join("\n"),
    );

    const result = runScanner(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Secret scan passed");
    expect(result.stderr).toBe("");
  });

  it("does not honor a fixture marker in production source", () => {
    const root = makeWorkspace();
    const fakeKey = `sk-${"p".repeat(40)}`;
    writeFileSync(
      resolve(root, "src/config.ts"),
      ["// secret-scan: allow-next-line -- test-fixture", `const providerKey = "${fakeKey}";`].join(
        "\n",
      ),
    );

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/config.ts:2 [OPENAI_API_KEY]");
    expect(result.stderr).not.toContain(fakeKey);
  });

  it("scans a non-empty secret in env examples but permits placeholders", () => {
    const root = makeWorkspace();
    const secret = `fake_${"q".repeat(48)}`;
    writeFileSync(
      resolve(root, ".env.example"),
      [
        `SUPABASE_SERVICE_ROLE_KEY=${secret}`,
        "GEMINI_API_KEY=<set-in-deployment-secret-store>",
        "NAVER_CLIENT_SECRET=${NAVER_CLIENT_SECRET}",
      ].join("\n"),
    );

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".env.example:1 [NAMED_SECRET_ASSIGNMENT]");
    expect(result.stderr).not.toContain(secret);
  });

  it("detects opaque Supabase secret keys and SECRET_KEY suffixes", () => {
    const root = makeWorkspace();
    const opaque = `sb_secret_${"s".repeat(32)}`;
    writeFileSync(
      resolve(root, "src/config.ts"),
      [`const SUPABASE_SECRET_KEY = "${opaque}";`].join("\n"),
    );

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/config.ts:1 [NAMED_SECRET_LITERAL]");
    expect(result.stderr).toContain("src/config.ts:1 [SUPABASE_SECRET_KEY]");
    expect(result.stderr).not.toContain(opaque);
  });

  it("permits legacy Supabase anon JWTs because they are publishable browser keys", () => {
    const root = makeWorkspace();
    const anonKey = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ iss: "supabase", ref: "fake-project", role: "anon" })).toString(
        "base64url",
      ),
      "a".repeat(43),
    ].join(".");
    writeFileSync(resolve(root, "src/public-config.ts"), `export const anonKey = "${anonKey}";\n`);

    const result = runScanner(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Secret scan passed");
    expect(result.stderr).toBe("");
  });

  it("blocks Korean phone and resident identifiers in production source", () => {
    const root = makeWorkspace();
    writeFileSync(
      resolve(root, "src/profile.ts"),
      'export const profile = "010-1234-5678 / 900101-1234567";\n',
    );

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/profile.ts:1 [KOREAN_PHONE]");
    expect(result.stderr).toContain("src/profile.ts:1 [KOREAN_RESIDENT_ID]");
    expect(result.stderr).not.toContain("010-1234-5678");
    expect(result.stderr).not.toContain("900101-1234567");
  });

  it("scans source _libs directories while excluding only generated Vercel vendor libraries", () => {
    const root = makeWorkspace();
    const sourceSecret = `sk-${"s".repeat(40)}`;
    const vendorSecret = `sk-${"v".repeat(40)}`;
    mkdirSync(resolve(root, "src/_libs"), { recursive: true });
    mkdirSync(resolve(root, ".vercel/output/functions/app.func/_libs"), { recursive: true });
    writeFileSync(resolve(root, "src/_libs/config.ts"), `export const value = "${sourceSecret}";`);
    writeFileSync(
      resolve(root, ".vercel/output/functions/app.func/_libs/vendor.js"),
      `export const value = "${vendorSecret}";`,
    );

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/_libs/config.ts:1 [OPENAI_API_KEY]");
    expect(result.stderr).not.toContain(".vercel/output/functions/app.func/_libs/vendor.js");
    expect(result.stderr).not.toContain(sourceSecret);
    expect(result.stderr).not.toContain(vendorSecret);
  });

  it("passes against the current project without exposing local environment files", () => {
    expect(() =>
      execFileSync(process.execPath, [scannerPath, process.cwd()], {
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  }, 20_000);
});
