import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function sourceOrEmpty(path: string): string {
  const absolutePath = resolve(root, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

const homeSource = sourceOrEmpty("src/routes/index.tsx");
const medicineRoutePath = resolve(root, "src/routes/medicine.tsx");
const publicMedicationPath = resolve(root, "src/lib/medication/public-info.server.ts");

describe("public-first service structure", () => {
  it("keeps shelter routing as the citizen home action", () => {
    expect(homeSource).toContain('to: "/shelters"');
    expect(homeSource).not.toContain('to: "/medicine"');
    expect(homeSource).not.toContain("복용약 정보 확인");
  });

  it("does not expose the retired public medication lookup", () => {
    expect(existsSync(medicineRoutePath)).toBe(false);
    expect(existsSync(publicMedicationPath)).toBe(false);
  });
});
