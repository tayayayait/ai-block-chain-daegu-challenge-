import { describe, expect, it } from "vitest";

import { renderErrorPage } from "./error-page";

describe("catastrophic server error page", () => {
  const html = renderErrorPage();
  const document = new DOMParser().parseFromString(html, "text/html");

  it("declares Korean and preserves zoom with the safe-area viewport", () => {
    expect(document.documentElement.lang).toBe("ko");
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe(
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
    expect(html).not.toMatch(/user-scalable=no|maximum-scale=1/);
  });

  it("offers a first-focus skip link and a focusable main target", () => {
    const firstElement = document.body.firstElementChild;
    const skipLink = document.querySelector<HTMLAnchorElement>('a[href="#main-content"]');
    const main = document.querySelector<HTMLElement>("main#main-content");

    expect(firstElement).toBe(skipLink);
    expect(skipLink?.textContent).toContain("본문으로 건너뛰기");
    expect(main?.getAttribute("tabindex")).toBe("-1");
  });

  it("uses a safe Korean message and recovery actions without internal diagnostics", () => {
    expect(document.querySelector("h1")?.textContent).toContain("서버에 일시적인 문제가 있습니다");
    expect(document.querySelector("p")?.textContent).toContain("잠시 후 다시 시도해 주세요.");
    expect(document.querySelector("button")?.textContent).toContain("다시 시도");
    expect(document.querySelector('a[href="/"]')?.textContent).toContain("홈으로 돌아가기");
    expect(html).not.toMatch(/This page didn't load|Something went wrong|stack|authKey|serviceKey/);
  });
});
