import { expect, test } from '@playwright/test';

/**
 * Installation settings. The behaviour worth guarding is the precedence made
 * visible: a value the environment pins is shown as managed and cannot be
 * edited, while an unpinned one is editable and reaches the rendered document.
 *
 * The e2e environment sets APP_BRAND_NAME and leaves APP_ORG_NAME unset, so one
 * field of each kind is on screen without the test having to arrange it.
 */

const ORG = 'E2E Scratch Organization';

async function signIn(page: import('@playwright/test').Page, handle: string) {
  await page.goto('/login');
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="password"]', 'draftledger');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/workspace/);
}

async function setOrgName(page: import('@playwright/test').Page, value: string) {
  await page.goto('/admin/settings');
  await page.fill('#setting-orgName', value);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.locator('.dl-notice').first()).toContainText(/Saved|No changes/);
  await expect(page.locator('#setting-orgName')).toHaveValue(value);
}

test.describe('installation settings', () => {
  // All three projects are chromium, so a browserName guard would run this
  // three times over one shared database and the runs would fight over the
  // stored value. An admin form has nothing viewport-specific to prove, and
  // only beforeEach is handed testInfo, so the project check lives there.
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one project is enough for this flow');
    await signIn(page, 'admin-1');
  });

  // Other suites render documents, so the scratch name must not outlive this
  // file.
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page, 'admin-1');
    await setOrgName(page, 'Example Organization');
    await page.close();
  });

  test('a setting pinned by the environment is shown as managed and is read-only', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Installation settings' })).toBeVisible();

    const brand = page.locator('#setting-brandName');
    await expect(brand).toBeDisabled();
    await expect(page.locator('#setting-brandName-help')).toContainText('APP_BRAND_NAME');
  });

  test('an unpinned setting is editable and survives a reload', async ({ page }) => {
    await setOrgName(page, ORG);

    await page.reload();
    await expect(page.locator('#setting-orgName')).toHaveValue(ORG);
    await expect(page.locator('label[for="setting-orgName"]')).toContainText('Set here');
  });

  test('a saved organization name reaches the rendered document header', async ({ page }) => {
    await setOrgName(page, ORG);

    const response = await page.request.post('/api/drafts/DRAFT-TEST-PROTOCOL/preview', {
      data: { source: '# Abstract\n\nRendered for the settings test.\n' },
    });
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain(ORG);
  });

  test('a non-admin cannot reach the screen', async ({ page }) => {
    await page.context().clearCookies();
    await signIn(page, 'author-1');
    await page.goto('/admin/settings');
    await expect(page.locator('.dl-error')).toContainText('Admin role required');
  });
});
