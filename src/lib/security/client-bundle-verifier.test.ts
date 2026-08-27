import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyClientBundle } from "../../../scripts/verify-client-bundle.mjs";

const roots: string[] = [];

function bundleRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), "onjung-client-bundle-"));
  roots.push(root);
  mkdirSync(resolve(root, "assets"));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("client bundle verifier", () => {
  it("accepts ordinary browser assets", async () => {
    const root = bundleRoot();
    writeFileSync(resolve(root, "assets/app.js"), 'console.log("온중");\n');

    await expect(verifyClientBundle(root)).resolves.toEqual({ filesScanned: 1 });
  });

  it.each([
    ["node crypto shim", 'import "node:crypto";'],
    ["server environment name", 'const name = "SUPABASE_SECRET_KEY";'],
    ["server AI package", 'const moduleName = "@google/genai";'],
    ["personal phone", 'const text = "010-1234-5678";'],
  ])("rejects %s without printing the matched value", async (_label, source) => {
    const root = bundleRoot();
    writeFileSync(resolve(root, "assets/app.js"), source);

    const error = await verifyClientBundle(root).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("assets/app.js");
    expect(String(error)).not.toContain(source);
  });
});
