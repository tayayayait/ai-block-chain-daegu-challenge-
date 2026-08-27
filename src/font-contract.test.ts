import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const styles = readFileSync(resolve(root, "src/styles.css"), "utf8");
const rootRoute = readFileSync(resolve(root, "src/routes/__root.tsx"), "utf8");
const normalizedStyles = styles.replace(/\s+/g, " ");

const FONT_ASSETS = {
  "public/fonts/wanted-sans/wanted-sans-variable-ksx1001.woff2":
    "e9d3c602974d5fba2aa4369349aa1e832455c55bfc793a205a5ca21a0ec054f8",
  "public/fonts/wanted-sans/wanted-sans-variable-latin.woff2":
    "a785fbc798025b7e672b36dd1df2264292b3117d9580d6f3ddf8c6df3ea0ca13",
  "public/fonts/pretendard/pretendard-variable.woff2":
    "9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4",
  "public/fonts/jetbrains-mono/jetbrains-mono-regular.woff2":
    "a9cb1cd82332b23a47e3a1239d25d13c86d16c4220695e34b243effa999f45f2",
  "public/fonts/jetbrains-mono/jetbrains-mono-bold.woff2":
    "c503cc5ec5f8b2c7666b7ecda1adf44bd45f2e6579b2eba0fc292150416588a2",
} as const;

const FONT_FILES = Object.keys(FONT_ASSETS) as Array<keyof typeof FONT_ASSETS>;

const LICENSE_FILES = [
  "public/fonts/licenses/wanted-sans-ofl.txt",
  "public/fonts/licenses/pretendard-ofl.txt",
  "public/fonts/licenses/jetbrains-mono-ofl.txt",
] as const;

function runFontVerifier() {
  const candidates = process.platform === "win32" ? ["python"] : ["python3", "python"];

  for (const command of candidates) {
    const result = spawnSync(command, ["scripts/verify-font-assets.py"], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.error && "code" in result.error && result.error.code === "ENOENT") {
      continue;
    }
    return result;
  }

  return undefined;
}

describe("self-hosted font contract", () => {
  it.each(FONT_FILES)("ships a valid WOFF2 asset: %s", (relativePath) => {
    const absolutePath = resolve(root, relativePath);

    expect(existsSync(absolutePath)).toBe(true);
    expect(statSync(absolutePath).size).toBeGreaterThan(0);
    expect(readFileSync(absolutePath).subarray(0, 4).toString("ascii")).toBe("wOF2");
  });

  it.each(FONT_FILES)("matches the audited SHA-256: %s", (relativePath) => {
    const actual = createHash("sha256")
      .update(readFileSync(resolve(root, relativePath)))
      .digest("hex");

    expect(actual).toBe(FONT_ASSETS[relativePath]);
  });

  it("declares every font face with swap and the required weights", () => {
    expect(styles.match(/font-family: "Wanted Sans Variable";/g)).toHaveLength(2);
    expect(styles).toContain('font-family: "Pretendard Variable";');
    expect(styles.match(/font-family: "JetBrains Mono";/g)).toHaveLength(2);
    expect(styles.match(/font-display: swap;/g)).toHaveLength(5);
    expect(styles).toContain("font-weight: 400 1000;");
    const pretendardWeight = styles.match(
      /font-family: "Pretendard Variable";[\s\S]*?font-weight: (\d+) (\d+);/,
    );
    expect(pretendardWeight).not.toBeNull();
    expect(Number(pretendardWeight?.[1])).toBeLessThanOrEqual(400);
    expect(Number(pretendardWeight?.[2])).toBeGreaterThanOrEqual(700);
    expect(styles).toContain("font-weight: 400;");
    expect(styles).toContain("font-weight: 700;");
  });

  it("uses Wanted Sans for display and keeps documented fallbacks", () => {
    expect(normalizedStyles).toContain(
      '--font-display-stack: "Wanted Sans Variable", "Pretendard Variable", Pretendard, -apple-system, sans-serif;',
    );
    expect(normalizedStyles).toContain(
      '--font-body-stack: "Pretendard Variable", Pretendard, -apple-system, "Malgun Gothic", sans-serif;',
    );
    expect(normalizedStyles).toContain(
      '--font-mono-stack: "JetBrains Mono", "D2Coding", ui-monospace, monospace;',
    );
  });

  it.each([
    "/fonts/wanted-sans/wanted-sans-variable-ksx1001.woff2",
    "/fonts/wanted-sans/wanted-sans-variable-latin.woff2",
    "/fonts/pretendard/pretendard-variable.woff2",
  ])("preloads the critical font %s", (href) => {
    expect(rootRoute).toContain(`href: "${href}"`);
  });

  it("marks font preloads as anonymous WOFF2 resources", () => {
    expect(rootRoute.match(/rel: "preload"/g)).toHaveLength(3);
    expect(rootRoute.match(/as: "font"/g)).toHaveLength(3);
    expect(rootRoute.match(/type: "font\/woff2"/g)).toHaveLength(3);
    expect(rootRoute.match(/crossOrigin: "anonymous"/g)).toHaveLength(3);
  });

  it("validates family, WOFF2 format, weight metadata, and cmap with fontTools", () => {
    const verifierPath = resolve(root, "scripts/verify-font-assets.py");
    expect(existsSync(verifierPath), "font asset verifier must exist").toBe(true);

    const result = runFontVerifier();

    expect(result, "Python is required to verify font assets").toBeDefined();
    expect(result?.status, `${result?.stdout ?? ""}${result?.stderr ?? ""}`).toBe(0);
    expect(result?.stdout).toContain("Verified 5 font assets");
  });
});

describe("font license provenance", () => {
  it.each(LICENSE_FILES)("ships the upstream OFL text: %s", (relativePath) => {
    const absolutePath = resolve(root, relativePath);

    expect(existsSync(absolutePath)).toBe(true);
    expect(readFileSync(absolutePath, "utf8")).toMatch(/SIL OPEN FONT LICENSE/i);
  });

  it("records versions, sources, hashes, and the 2,350-glyph subset", () => {
    const documentPath = resolve(root, "docs/font-licenses.md");

    expect(existsSync(documentPath)).toBe(true);
    const document = readFileSync(documentPath, "utf8");
    expect(document).toContain("Wanted Sans v1.0.3");
    expect(document).toContain("Pretendard v1.3.9");
    expect(document).toContain("JetBrains Mono v2.304");
    expect(document).toContain("2,350");
    expect(document).toContain("가변 45–930 전체");
    expect(document).not.toContain("가변 45–920 전체");
    for (const [relativePath, sha256] of Object.entries(FONT_ASSETS)) {
      expect(document).toContain(`\`${relativePath}\``);
      expect(document).toContain(`\`${sha256}\``);
    }
    expect(document).toContain("https://github.com/wanteddev/wanted-sans/releases/tag/v1.0.3");
    expect(document).toContain("https://github.com/orioncactus/pretendard/releases/tag/v1.3.9");
    expect(document).toContain("https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304");
  });

  it("pins and documents the reproducible font toolchain", () => {
    const requirementsPath = resolve(root, "requirements-fonts.txt");
    expect(existsSync(requirementsPath), "font requirements must exist").toBe(true);

    const requirements = readFileSync(requirementsPath, "utf8").trim().split(/\r?\n/);
    const document = readFileSync(resolve(root, "docs/font-licenses.md"), "utf8");

    expect(requirements).toEqual(["fonttools==4.63.0", "brotli==1.2.0"]);
    expect(document).toContain("requirements-fonts.txt");
    expect(document).toContain("python -m pip install --requirement requirements-fonts.txt");
    expect(document).toContain("python scripts\\verify-font-assets.py");
  });
});
