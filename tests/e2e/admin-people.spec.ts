import { expect, test } from '@playwright/test';

/** Links carry APP_BASE_URL, which is not the port the suite runs against. */
function pathOf(link: string): string {
  return new URL(link).pathname;
}

/** People, credentials and team administration through the admin screens. */

const HANDLE = 'e2e-scratch-person';
const NAME = 'E2E Scratch Person';
const TEAM_SLUG = 'e2e-scratch-team';

async function signIn(page: import('@playwright/test').Page, handle: string) {
  await page.goto('/login');
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="password"]', 'draftledger');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/workspace/);
}

/** Reuses the fixture row: a person with audit history can never be deleted. */
async function ensurePerson(page: import('@playwright/test').Page) {
  await page.goto('/admin/people');
  const row = page.locator('tr', { has: page.locator('td.dl-mono', { hasText: HANDLE }) });
  if ((await row.count()) > 0) {
    await row.first().getByRole('button', { name: 'Manage' }).click();
    return;
  }
  await page.fill('input[name="displayName"]', NAME);
  await page.fill('input[name="handle"]', HANDLE);
  await page.fill('input[name="email"]', 'scratch@example.invalid');
  await page.getByRole('button', { name: 'Create person' }).click();
  await expect(page.locator('.dl-notice')).toContainText('Created');
  await page.locator('tr', { has: page.locator('td.dl-mono', { hasText: HANDLE }) })
    .first()
    .getByRole('button', { name: 'Manage' })
    .click();
}

test.describe('admin people and teams', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough for flows');

  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin-1');
  });

  test('an admin creates a person and generates a one-time password', async ({ page }) => {
    await ensurePerson(page);

    await page.getByRole('button', { name: 'Generate a password' }).click();
    const secret = page.getByTestId('secret-reveal');
    await expect(secret).toBeVisible();
    await expect(secret).toContainText('not be shown again');
    const shown = await secret.locator('code').innerText();
    expect(shown.length).toBeGreaterThanOrEqual(12);

    // The value exists only in that response: a reload must not bring it back.
    await page.reload();
    await expect(page.getByTestId('secret-reveal')).toHaveCount(0);
  });

  test('an invite link is issued once and redeems into a signed-in session', async ({ page }) => {
    await ensurePerson(page);

    await page.getByRole('button', { name: 'Copy invite link' }).click();
    const link = await page.getByTestId('secret-reveal').locator('code').innerText();
    expect(link).toContain('/invite/');

    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign out' }).click().catch(() => {});
    await page.context().clearCookies();

    await page.goto(pathOf(link));
    await expect(page.getByRole('heading', { name: /set your password/i })).toBeVisible();
    await page.fill('input[name="password"]', 'a brand new password');
    await page.fill('input[name="confirm"]', 'a brand new password');
    await page.getByRole('button', { name: /Set password/ }).click();
    await page.waitForURL(/\/workspace/);

    // Single use: the same link must not work twice.
    await page.context().clearCookies();
    await page.goto(pathOf(link));
    await expect(page.getByRole('heading', { name: /cannot be used/i })).toBeVisible();
    await expect(page.locator('.dl-error')).toContainText('already been used');
  });

  test('mismatched passwords are refused on the redeem page', async ({ page }) => {
    await ensurePerson(page);
    await page.getByRole('button', { name: 'Copy reset link' }).click();
    const link = await page.getByTestId('secret-reveal').locator('code').innerText();

    await page.context().clearCookies();
    await page.goto(pathOf(link));
    await page.fill('input[name="password"]', 'first valid password');
    await page.fill('input[name="confirm"]', 'second valid password');
    await page.getByRole('button', { name: /Set password/ }).click();
    await expect(page.locator('.dl-error')).toContainText('do not match');
  });

  test('emailing a link is refused while no transport is configured', async ({ page }) => {
    await ensurePerson(page);
    const emailButton = page.getByRole('button', { name: 'Email invite' });
    // The control is disabled precisely because SMTP is unset in this environment.
    await expect(emailButton).toBeDisabled();
    await expect(page.locator('.dl-card', { hasText: 'Invite and reset links' })).toContainText(
      'No SMTP transport is configured',
    );
  });

  test('an admin cannot strip their own admin role', async ({ page }) => {
    await page.goto('/admin/people');
    await page.locator('tr', { has: page.locator('td.dl-mono', { hasText: 'admin-1' }) })
      .first()
      .getByRole('button', { name: 'Manage' })
      .click();
    await page.selectOption('select[name="orgRole"]', 'reader');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.dl-error')).toContainText('cannot remove your own admin role');
  });

  test('a team is created, renamed and given a member', async ({ page }) => {
    await page.goto('/admin/teams');

    const existing = page.locator('tr', { has: page.locator('td.dl-mono', { hasText: TEAM_SLUG }) });
    if ((await existing.count()) === 0) {
      await page.fill('input[name="name"]', 'E2E Scratch Team');
      await page.fill('input[name="slug"]', TEAM_SLUG);
      await page.getByRole('button', { name: 'Create team' }).click();
      await expect(page.locator('.dl-notice')).toContainText('Created');
    }

    await page.locator('tr', { has: page.locator('td.dl-mono', { hasText: TEAM_SLUG }) })
      .first()
      .getByRole('button', { name: 'Manage' })
      .click();

    // The name is editable; the slug is fixed because it is the permanent URL.
    await page.fill('input[name="name"]', 'E2E Scratch Team Renamed');
    await expect(page.locator('input[value="' + TEAM_SLUG + '"]')).toHaveAttribute('readonly', '');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.dl-notice')).toContainText('Updated E2E Scratch Team Renamed');

    // Scoped to the membership card: the team form has its own notice.
    const membership = page.locator('.dl-card', { hasText: 'Membership —' });
    await membership.locator('select[name="role"]').selectOption('reviewer');
    await membership.getByRole('button', { name: 'Add member' }).click();
    await expect(membership.locator('.dl-notice, .dl-error')).toContainText(/Membership added|already holds/);
  });

  test('a non-admin cannot reach the people screen', async ({ page }) => {
    await signIn(page, 'author-1');
    await page.goto('/admin/people');
    await expect(page.locator('.dl-error')).toContainText('Admin role required');
  });
});
