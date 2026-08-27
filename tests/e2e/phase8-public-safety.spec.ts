import { expect, test } from "@playwright/test";

test.describe("Phase 8 public safety surface", () => {
  test("home exposes live-source evidence or an explicit upstream delay without fixture values", async ({
    page,
  }) => {
    const response = await page.goto("/");

    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { level: 1, name: /온중/u })).toBeVisible();
    await expect(
      page.getByText(
        /기상청 API허브 500m 관측|기상청 단기예보 보완값|기상 관측을 일시적으로 불러오지 못했습니다/u,
      ),
    ).toBeVisible();
    await expect(page.getByText(/대구 무더위쉼터 [\d,]+곳|쉼터 수 집계 지연/u)).toBeVisible();
    await expect(page.getByText(/시연용 목데이터/u)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /쉼터 지도 · 보행 경로/u })).toHaveAttribute(
      "href",
      "/shelters",
    );
    await expect(page.getByRole("link", { name: /온체인 증명 검증/u })).toHaveCount(0);
  });

  // These are deliberately skipped instead of turning injected transport tests into a false
  // claim that third-party credentials, quotas, live data, or external ledgers were exercised.
  test.skip("[EXTERNAL CONFIG REQUIRED] live KMA/Gemini/MFDS/Naver/TMAP/Supabase credential smoke", async () => {});
  test.skip("[EXTERNAL CONFIG REQUIRED] Base Sepolia schema registration and confirmation smoke", async () => {});
  test.skip("[EXTERNAL PROVIDER NOT CONFIGURED] live SMS/Alimtalk delivery receipt smoke", async () => {});
});
