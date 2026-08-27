import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/routes/__root.tsx"), "utf8");
const manifestSource = readFileSync(resolve(process.cwd(), "public/site.webmanifest"), "utf8");
const errorComponentSource = source.slice(
  source.indexOf("function ErrorComponent"),
  source.indexOf("export const Route"),
);

describe("root document contract", () => {
  it("declares the Korean locale and an accessible safe-area viewport", () => {
    expect(source).toContain('<html lang="ko">');
    expect(source).toContain('content: "width=device-width, initial-scale=1, viewport-fit=cover"');
    expect(source).not.toMatch(/user-scalable=no|maximum-scale=1/);
  });

  it("uses citizen-first Onjung metadata without Lovable placeholder branding", () => {
    expect(source).toContain('title: "온중 溫證 — 대구 폭염 안전 안내"');
    expect(source).toContain(
      "대구 시민이 현재 더위와 가까운 쉼터를 확인하는 폭염 안전 서비스입니다.",
    );
    expect(source).toContain('name: "author", content: "온중"');
    expect(source).toContain('property: "og:title", content: "온중 溫證"');
    expect(manifestSource).toContain("온중 溫證 — 대구 폭염 안전 안내");
    expect(manifestSource).toContain("현재 더위와 가까운 쉼터");
    expect(`${source}\n${manifestSource}`).not.toContain("복용약 정보");
    expect(`${source}\n${manifestSource}`).not.toContain("폭염 취약 어르신");
    expect(source).not.toMatch(/Lovable App|Lovable Generated Project|@Lovable/);
  });

  it("keeps the three critical font preloads", () => {
    expect(source.match(/rel: "preload"/g)).toHaveLength(3);
    expect(source).toContain('href: "/fonts/wanted-sans/wanted-sans-variable-ksx1001.woff2"');
    expect(source).toContain('href: "/fonts/wanted-sans/wanted-sans-variable-latin.woff2"');
    expect(source).toContain('href: "/fonts/pretendard/pretendard-variable.woff2"');
  });

  it("puts a keyboard skip link before the focusable content target", () => {
    expect(source).toMatch(
      /<body>\s*<a[\s\S]*?href="#main-content"[\s\S]*?>\s*본문으로 건너뛰기\s*<\/a>/,
    );
    expect(source).toContain('id="main-content"');
    expect(source).toContain("tabIndex={-1}");
  });

  it("shows Korean 404 and 500 recovery actions", () => {
    expect(source).toContain("페이지를 찾을 수 없습니다");
    expect(source).toContain("주소가 잘못되었거나 페이지가 이동했습니다.");
    expect(source).toContain("서버에 일시적인 문제가 있습니다");
    expect(source).toContain("잠시 후 다시 시도해 주세요.");
    expect(source).toContain("다시 시도");
    expect(source).toContain("홈으로 돌아가기");
    expect(source).not.toMatch(/Page not found|This page didn't load|Try again|Go home/);
  });

  it("retains the safe root telemetry boundary", () => {
    expect(source).toContain(
      'reportLovableError(error, { boundary: "tanstack_root_error_component" })',
    );
  });

  it("does not send the raw root error or its properties to the console", () => {
    expect(errorComponentSource).not.toMatch(
      /console\.(?:error|warn|log|debug)\s*\(\s*error(?:\.|\s*[),])/,
    );
  });
});
