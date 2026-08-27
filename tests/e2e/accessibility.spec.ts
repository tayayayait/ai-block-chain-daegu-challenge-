import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PUBLIC_HOME_HEADING = "온중";

async function openPublicHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /온중/ })).toContainText(
    PUBLIC_HOME_HEADING,
  );
  await expect(page.getByText(/Application Error/i)).toHaveCount(0);
}

function durationToMilliseconds(value: string): number {
  const normalized = value.trim();
  if (normalized.endsWith("ms")) return Number.parseFloat(normalized);
  if (normalized.endsWith("s")) return Number.parseFloat(normalized) * 1_000;
  return Number.NaN;
}

test.describe("공개 홈 접근성", () => {
  test("axe serious/critical 위반이 없다", async ({ page }) => {
    await openPublicHome(page);

    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const severeViolations = result.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    );
    const details = severeViolations
      .map(
        ({ id, impact, help, nodes }) =>
          `${impact ?? "unknown"} ${id}: ${help}\n${nodes
            .map(({ target, failureSummary }) => `  ${target.join(" ")} — ${failureSummary ?? ""}`)
            .join("\n")}`,
      )
      .join("\n\n");

    expect(severeViolations, details).toHaveLength(0);
  });

  test("첫 Tab에서 건너뛰기 링크가 보이고 본문으로 초점을 옮긴다", async ({ page }) => {
    await openPublicHome(page);

    const skipLink = page.getByRole("link", { name: "본문으로 건너뛰기" });
    await page.keyboard.press("Tab");

    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    const skipFocus = await skipLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(skipFocus.outlineStyle).not.toBe("none");
    expect(skipFocus.outlineWidth).toBeGreaterThanOrEqual(2);

    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    await page.keyboard.press("Tab");
    const firstMainControl = page.locator(":focus");
    await expect(firstMainControl).toBeVisible();
    await expect(firstMainControl).toHaveAttribute("href", "/");
    const controlFocus = await firstMainControl.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(controlFocus.outlineStyle).not.toBe("none");
    expect(controlFocus.outlineWidth).toBeGreaterThanOrEqual(2);
  });

  test("prefers-reduced-motion에서 애니메이션과 전환이 사실상 제거된다", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPublicHome(page);

    const movingElements = page.locator(
      '[class*="animate-"], [class*="pulse-"], [class*="transition-"], [style*="animation"], [style*="transition"]',
    );
    expect(await movingElements.count()).toBeGreaterThan(0);

    const motion = await movingElements.evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          animationDuration: style.animationDuration,
          animationIterationCount: style.animationIterationCount,
          transitionDuration: style.transitionDuration,
        };
      }),
    );

    for (const [index, style] of motion.entries()) {
      const animationDurations = style.animationDuration.split(",").map(durationToMilliseconds);
      const transitionDurations = style.transitionDuration.split(",").map(durationToMilliseconds);
      expect(
        animationDurations.every((duration) => Number.isFinite(duration) && duration <= 0.001),
        `요소 ${index}의 animation-duration: ${style.animationDuration}`,
      ).toBe(true);
      expect(
        transitionDurations.every((duration) => Number.isFinite(duration) && duration <= 0.001),
        `요소 ${index}의 transition-duration: ${style.transitionDuration}`,
      ).toBe(true);
      expect(
        style.animationIterationCount
          .split(",")
          .every((count) => count.trim() === "1" || count.trim() === "0"),
        `요소 ${index}의 animation-iteration-count: ${style.animationIterationCount}`,
      ).toBe(true);
    }
  });
});
