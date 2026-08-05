import { expect, test } from '@playwright/test';

test('loads the 3D arena and starts from spot selection', async ({ page }, testInfo) => {
  await page.goto('/?fast=1');
  await expect(page.getByRole('heading', { name: /选定你的/ })).toBeVisible();
  await expect(page.locator('[data-spot]')).toHaveCount(5);
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const dimensions = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
  }));
  expect(dimensions.width).toBeGreaterThan(300);
  expect(dimensions.height).toBeGreaterThan(200);
  await page.screenshot({ path: testInfo.outputPath('selector.png'), fullPage: true });
});

test('supports keyboard charging and local best-score persistence', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Full round is covered once; mobile input has its own focused test.');
  test.setTimeout(70_000);
  await page.goto('/?fast=1');
  await page.getByRole('button', { name: /弧顶/ }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#shoot-button')).toBeAttached();

  for (let shot = 0; shot < 25; shot += 1) {
    await expect(page.locator('#meter')).toBeVisible();
    await page.keyboard.down('Space');
    await page.waitForTimeout(680);
    await page.keyboard.up('Space');
    if (shot < 24) await expect(page.locator('#meter')).toBeVisible({ timeout: 2_000 });
  }

  await expect(page.getByRole('heading', { name: '挑战完成' })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#result-score')).toHaveText('30');
  await page.reload();
  await expect(page.locator('[data-best-for="top"]')).toHaveText('30');
});

test('shows the press-and-hold control on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?fast=1');
  await page.getByRole('button', { name: /右侧 45/ }).click();
  const button = page.locator('#shoot-button');
  await expect(button).toBeVisible();
  await expect(button).toHaveText(/按住/);
});
