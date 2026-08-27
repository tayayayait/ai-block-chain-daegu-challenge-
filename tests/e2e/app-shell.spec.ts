import { expect, test } from "@playwright/test";

test("홈 화면이 치명적 오류 없이 열린다", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByText(/Application Error/i)).toHaveCount(0);
});
