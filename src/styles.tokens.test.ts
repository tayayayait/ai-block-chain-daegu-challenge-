import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const blockOf = (selector: string) => {
  const start = styles.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  if (start < 0) return "";

  const bodyStart = styles.indexOf("{", start) + 1;
  const end = styles.indexOf("}", bodyStart);
  return styles.slice(bodyStart, end);
};

const propertyOf = (block: string, property: string) => {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:\\s*([^;]+);`));
  expect(match, `${property} declaration`).not.toBeNull();
  return normalize(match?.[1] ?? "");
};

describe("layout design tokens", () => {
  const root = blockOf(":root");

  it.each([
    ["--sp-1", "4px"],
    ["--sp-2", "8px"],
    ["--sp-3", "12px"],
    ["--sp-4", "16px"],
    ["--sp-5", "20px"],
    ["--sp-6", "24px"],
    ["--sp-8", "32px"],
    ["--sp-10", "40px"],
    ["--sp-12", "48px"],
    ["--sp-16", "64px"],
    ["--sp-20", "80px"],
  ])("%s 간격을 %s로 고정한다", (token, value) => {
    expect(propertyOf(root, token)).toBe(value);
  });

  it.each([
    ["--z-base", "0"],
    ["--z-sticky", "100"],
    ["--z-topbar", "200"],
    ["--z-dropdown", "300"],
    ["--z-overlay", "400"],
    ["--z-modal", "500"],
    ["--z-toast", "600"],
    ["--z-alert-l4", "700"],
  ])("%s 레이어를 %s로 고정한다", (token, value) => {
    expect(propertyOf(root, token)).toBe(value);
  });
});

describe("surface shadow tokens", () => {
  const root = blockOf(":root");
  const theme = blockOf("@theme inline");
  const shade = blockOf(".shade");

  it.each([
    ["--sh-1", "0 1px 2px rgba(13, 20, 24, 0.06), 0 1px 3px rgba(13, 20, 24, 0.04)"],
    ["--sh-2", "0 4px 8px rgba(13, 20, 24, 0.06), 0 2px 4px rgba(13, 20, 24, 0.04)"],
    ["--sh-3", "0 12px 24px rgba(13, 20, 24, 0.1), 0 4px 8px rgba(13, 20, 24, 0.06)"],
  ])("Paper %s 값을 명세대로 제공한다", (token, value) => {
    expect(propertyOf(root, token)).toBe(value);
  });

  it.each([
    ["--shadow-sh-1", "var(--sh-1)"],
    ["--shadow-sh-2", "var(--sh-2)"],
    ["--shadow-sh-3", "var(--sh-3)"],
  ])("Tailwind %s가 surface 토큰을 참조한다", (token, value) => {
    expect(propertyOf(theme, token)).toBe(value);
  });

  it.each(["--sh-1", "--sh-2", "--sh-3"])("Shade에서 %s를 제거한다", (token) => {
    expect(propertyOf(shade, token)).toBe("none");
  });

  it("Shade 계층은 명세의 전용 1px 보더 토큰을 사용한다", () => {
    expect(propertyOf(root, "--shade-border")).toBe("#26363d");
    expect(propertyOf(shade, "--border")).toBe("var(--shade-border)");
  });
});

describe("safe area and focus visibility", () => {
  const root = blockOf(":root");

  it.each([
    ["--safe-area-left", "max(var(--sp-4), env(safe-area-inset-left))"],
    ["--safe-area-right", "max(var(--sp-4), env(safe-area-inset-right))"],
    ["--safe-area-bottom", "max(var(--sp-4), env(safe-area-inset-bottom))"],
  ])("%s 안전 영역을 제공한다", (token, value) => {
    expect(propertyOf(root, token)).toBe(value);
  });

  it("좌우와 하단 safe-area 유틸이 중앙 토큰을 소비한다", () => {
    const safeInline = blockOf(".safe-x");
    const safeBottom = blockOf(".safe-b");

    expect(propertyOf(safeInline, "padding-left")).toBe("var(--safe-area-left)");
    expect(propertyOf(safeInline, "padding-right")).toBe("var(--safe-area-right)");
    expect(propertyOf(safeBottom, "padding-bottom")).toBe("var(--safe-area-bottom)");
  });

  it("포커스 가능한 요소에 TopBar 높이만큼 scroll margin을 둔다", () => {
    expect(styles).toContain("scroll-margin-top: var(--sp-20);");
  });
});

describe("senior control tokens", () => {
  const root = blockOf(":root");
  const senior = blockOf(".senior");

  it("Paper 기본 버튼과 아이콘 크기를 제공한다", () => {
    expect(propertyOf(root, "--btn-h")).toBe("48px");
    expect(propertyOf(root, "--icon-size")).toBe("20px");
  });

  it("시니어 모드 버튼과 아이콘 크기를 확대한다", () => {
    expect(propertyOf(senior, "--btn-h")).toBe("60px");
    expect(propertyOf(senior, "--icon-size")).toBe("28px");
  });
});
