import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile-small", width: 360, height: 800 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1_024 },
  { name: "laptop", width: 1_024, height: 900 },
  { name: "desktop", width: 1_280, height: 900 },
  { name: "desktop-wide", width: 1_600, height: 1_000 },
] as const;

async function openPublicHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /온중/ })).toBeVisible();
  await expect(page.getByText(/Application Error/i)).toHaveCount(0);
}

async function expectInsideHorizontalViewport(locator: Locator, viewportWidth: number) {
  const box = await locator.boundingBox();
  expect(box, "요소의 레이아웃 박스를 계산할 수 있어야 합니다.").not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(-1);
  expect((box?.x ?? viewportWidth + 2) + (box?.width ?? 0)).toBeLessThanOrEqual(viewportWidth + 1);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px에서 가로 오버플로 없이 실데이터 상태를 유지한다`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openPublicHome(page);

    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    expect(overflow.document, `${viewport.name} 문서 가로 오버플로`).toBeLessThanOrEqual(1);
    expect(overflow.body, `${viewport.name} body 가로 오버플로`).toBeLessThanOrEqual(1);

    const weatherStatus = page.getByText(
      /기상청 API허브 500m 관측|기상청 단기예보 보완값|기상 관측을 일시적으로 불러오지 못했습니다/u,
    );
    const shelterStatus = page.getByText(/대구 무더위쉼터 [\d,]+곳|쉼터 수 집계 지연/u);

    await expect(weatherStatus).toBeVisible();
    await expect(shelterStatus).toBeVisible();
    await expectInsideHorizontalViewport(weatherStatus, viewport.width);
    await expectInsideHorizontalViewport(shelterStatus, viewport.width);
  });
}

test("200% 확대에 해당하는 640 CSS px 리플로우에서도 핵심 정보가 유지된다", async ({ page }) => {
  // 1280px 데스크톱을 200%로 확대하면 콘텐츠가 사용할 수 있는 CSS 폭은 640px입니다.
  await page.setViewportSize({ width: 640, height: 900 });
  await openPublicHome(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "200% 확대 대응 리플로우의 가로 오버플로").toBeLessThanOrEqual(1);

  const weatherStatus = page.getByText(
    /기상청 API허브 500m 관측|기상청 단기예보 보완값|기상 관측을 일시적으로 불러오지 못했습니다/u,
  );
  const shelterStatus = page.getByText(/대구 무더위쉼터 [\d,]+곳|쉼터 수 집계 지연/u);

  await expect(weatherStatus).toBeVisible();
  await expect(shelterStatus).toBeVisible();
  await expectInsideHorizontalViewport(weatherStatus, 640);
  await expectInsideHorizontalViewport(shelterStatus, 640);
});
