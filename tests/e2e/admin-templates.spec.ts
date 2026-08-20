import { expect, test } from '@playwright/test';

/** Template administration: create, offer in the wizard, edit, delete. */

const KEY = 'e2e-scratch-template';
const NAME = 'E2E scratch template';

async function signIn(page: import('@playwright/test').Page, handle: string) {
  await page.goto('/login');
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="password"]', 'draftledger');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/workspace/);
}

/** Leaves no row behind, so the suite stays repeatable. */
async function removeIfPresent(page: import('@playwright/test').Page) {
  await page.goto('/admin/templates');
  const row = page.locator('tr', { has: page.locator('td.dl-mono', { hasText: KEY }) });
  if ((await row.count()) === 0) return;
  await row.first().getByRole('button', { name: 'Delete' }).click();
  await row.first().getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.locator('.dl-notice')).toContainText('Deleted');
}

test.describe('admin templates', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough for flows');

  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin-1');
    await removeIfPresent(page);
  });

  test.afterEach(async ({ page }) => {
    await removeIfPresent(page);
  });

  test('an admin creates a template and the wizard offers it', async ({ page }) => {
    await page.goto('/admin/templates');
    await expect(page.getByRole('heading', { name: 'Document templates' })).toBeVisible();

    await page.fill('input[name="name"]', NAME);
    await page.fill('input[name="key"]', KEY);
    await page.fill('input[name="description"]', 'Created by the end-to-end suite.');
    await page.fill('textarea[name="body"]', '---\ntitle: {{title}}\n---\n\n# Abstract\n\n{{abstract}}\n');
    await page.getByRole('button', { name: 'Create template' }).click();

    await expect(page.locator('.dl-notice')).toContainText(`Created the ${NAME} template`);
    await expect(page.locator('td.dl-mono', { hasText: KEY })).toBeVisible();

    // The creation wizard reads the same list, so the new template must appear there.
    await page.goto('/drafts/new');
    await page.selectOption('select[name="mode"]', 'template');
    await expect(page.locator('select[name="template"] option', { hasText: NAME })).toHaveCount(1);
  });

  test('an edit updates the stored template', async ({ page }) => {
    await page.goto('/admin/templates');
    await page.fill('input[name="name"]', NAME);
    await page.fill('input[name="key"]', KEY);
    await page.fill('textarea[name="body"]', '# Abstract\n');
    await page.getByRole('button', { name: 'Create template' }).click();
    await expect(page.locator('.dl-notice')).toContainText('Created');

    const row = page.locator('tr', { has: page.locator('td.dl-mono', { hasText: KEY }) });
    await row.first().getByRole('button', { name: 'Edit' }).click();
    await page.fill('input[name="description"]', 'Edited by the end-to-end suite.');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.locator('.dl-notice')).toContainText(`Updated the ${NAME} template`);
    await expect(page.locator('tr', { hasText: KEY })).toContainText('Edited by the end-to-end suite.');
  });

  test('a malformed key is rejected', async ({ page }) => {
    await page.goto('/admin/templates');
    await page.fill('input[name="name"]', NAME);
    // The input carries a pattern, so bypass native validation to reach the server check.
    await page.locator('input[name="key"]').evaluate((el) => el.removeAttribute('pattern'));
    await page.fill('input[name="key"]', 'Not A Key');
    await page.fill('textarea[name="body"]', '# Abstract\n');
    await page.getByRole('button', { name: 'Create template' }).click();

    await expect(page.locator('.dl-error')).toContainText('lower-case words joined by hyphens');
  });

  test('a duplicate key is rejected', async ({ page }) => {
    await page.goto('/admin/templates');
    await page.fill('input[name="name"]', NAME);
    await page.fill('input[name="key"]', 'standards-track-default');
    await page.fill('textarea[name="body"]', '# Abstract\n');
    await page.getByRole('button', { name: 'Create template' }).click();

    await expect(page.locator('.dl-error')).toContainText('already used by another template');
  });

  test('a non-admin cannot reach the template screen', async ({ page }) => {
    await signIn(page, 'author-1');
    await page.goto('/admin/templates');
    await expect(page.locator('.dl-error')).toContainText('Admin role required');
  });
});
