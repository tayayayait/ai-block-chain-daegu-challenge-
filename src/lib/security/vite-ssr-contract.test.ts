import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const config = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

describe("Vite SSR dependency contract", () => {
  it("bundles the EAS SDK and lodash together for dev SSR CommonJS interop", () => {
    expect(config).toMatch(/ssr\s*:\s*\{[\s\S]*noExternal\s*:/u);
    expect(config).toContain('"@ethereum-attestation-service/eas-sdk"');
    expect(config).toContain('"lodash"');
  });
});
