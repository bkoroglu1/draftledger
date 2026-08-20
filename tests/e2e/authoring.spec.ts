import { expect, test } from '@playwright/test';

/** Authoring, review, approval and publication acceptance checks. */

async function signIn(page: import('@playwright/test').Page, handle: string) {
  await page.goto('/login');
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="password"]', 'draftledger');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/workspace/);
}

test.describe('authoring', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough for flows');

  test('private drafts are hidden from anonymous readers', async ({ page }) => {
    const response = await page.goto('/doc/html/DRAFT-TEST-PROTOCOL');
    expect(response?.status()).toBe(404);
  });

  test('an author can open the workspace and the editor', async ({ page }) => {
    await signIn(page, 'author-1');
    await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'DRAFT-TEST-PROTOCOL' }).first()).toBeVisible();

    await page.goto('/drafts/DRAFT-TEST-PROTOCOL/edit');
    await expect(page.locator('#dl-source')).toBeVisible();
    await expect(page.locator('.dl-preview pre.dl-page').first()).toBeVisible();
  });

  test('the editor preview matches the publishing renderer', async ({ page }) => {
    await signIn(page, 'author-1');
    await page.goto('/drafts/DRAFT-TEST-PROTOCOL/edit');
    const preview = page.locator('.dl-preview').first();
    await expect(preview).toContainText('Example Ledger Notification Protocol');
    await expect(preview).toContainText('[Page 1]');

    await page.getByRole('tab', { name: 'Outline' }).click();
    await expect(page.locator('.dl-contents-tree')).toContainText('Security Considerations');
  });

  test('validation errors surface in the diagnostics panel', async ({ page }) => {
    await signIn(page, 'author-1');
    await page.goto('/drafts/DRAFT-TEST-PROTOCOL/edit');

    const source = page.locator('#dl-source');
    const original = await source.inputValue();
    await source.fill(`${original}\n\nBroken reference to {{section-99}} and [MISSING].\n`);

    await page.getByRole('tab', { name: /Diagnostics/ }).click();
    await expect(page.locator('.dl-diagnostic[data-severity="error"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // Put the draft back so the suite stays repeatable.
    await source.fill(original);
    await page.waitForTimeout(1800);
  });

  test('publication is blocked by an open blocking thread and a missing approval', async ({ page }) => {
    await signIn(page, 'author-1');
    await page.goto('/drafts/DRAFT-TEST-PROTOCOL/publish');
    await expect(page.getByRole('heading', { name: 'Approval gates' })).toBeVisible();
    await expect(page.locator('.dl-gate[data-satisfied="false"]').first()).toBeVisible();
    await expect(page.locator('body')).toContainText('Your role cannot publish in this namespace');
  });

  test('a reviewer can comment but not edit the source', async ({ page }) => {
    await signIn(page, 'reviewer-1');
    await page.goto('/drafts/DRAFT-TEST-PROTOCOL/edit');
    await expect(page.locator('#dl-source')).toHaveAttribute('readonly', '');

    await page.goto('/drafts/DRAFT-TEST-PROTOCOL/reviews');
    await expect(page.getByRole('heading', { name: 'Open a review thread' })).toBeVisible();
  });

  test('a published document cannot be edited', async ({ page }) => {
    await signIn(page, 'author-1');
    await page.goto('/drafts/TEST-STD-0001/edit');
    await expect(page.locator('#dl-source')).toHaveAttribute('readonly', '');
    await expect(page.locator('body')).toContainText('Published documents are immutable');
  });

  test('the admin can preview a notification expansion without sending', async ({ page }) => {
    await signIn(page, 'admin-1');
    await page.goto('/admin/notification-policies');
    await expect(page.getByRole('heading', { name: 'Notification policies' })).toBeVisible();

    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.locator('pre.dl-page').last()).toContainText('No message was sent');
  });

  test('non-admins cannot reach the admin screens', async ({ page }) => {
    await signIn(page, 'author-1');
    await page.goto('/admin/workflows');
    await expect(page.locator('.dl-error')).toContainText('Admin role required');
  });
});
