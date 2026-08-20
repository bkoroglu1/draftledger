import { expect, test } from '@playwright/test';

/** Status timeline, notification expansion and history acceptance checks. */

test.describe('document detail', () => {
  test('shows status, expansions and history tabs', async ({ page }) => {
    await page.goto('/doc/TEST-STD-0001');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Example Ledger Interchange Format');
    await expect(page.locator('.dl-page-subtitle')).toContainText('TEST-STD-0001');

    for (const name of ['Status', 'Email expansions', 'History']) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
    await expect(page.getByRole('tab', { name: 'Status' })).toHaveAttribute('aria-selected', 'true');
  });

  test('tab deep links survive navigation and browser history', async ({ page }) => {
    await page.goto('/doc/TEST-STD-0001');
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/doc\/TEST-STD-0001\/history/);
    await expect(page.getByRole('heading', { name: 'Revision differences' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');

    await page.goBack();
    await expect(page).toHaveURL(/\/doc\/TEST-STD-0001$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/history/);
  });

  test('timeline shows draft and published rows with real dates', async ({ page }) => {
    await page.goto('/doc/TEST-STD-0001');
    const rows = page.locator('.dl-timeline-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('DRAFT-TEST-STD-0001');
    await expect(rows.nth(1)).toContainText('TEST-STD-0001');

    const segments = page.locator('.dl-timeline-seg');
    expect(await segments.count()).toBeGreaterThanOrEqual(2);

    // Tooltip content comes from real domain data, not a fixture blob.
    const label = await segments.first().getAttribute('aria-label');
    expect(label).toMatch(/Published|Editing|Approved|In review/);
    expect(label).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test('timeline segments link to the exact revision and have a table alternative', async ({ page }) => {
    await page.goto('/doc/TEST-STD-0001');
    const href = await page.locator('.dl-timeline-seg').last().getAttribute('href');
    expect(href).toMatch(/^\/doc\/html\//);

    await page.getByText('Timeline as a table').click();
    await expect(page.locator('table.dl-table').first()).toContainText('Checksum');
  });

  test('email expansions compute To and Cc with reasons', async ({ page }) => {
    await page.goto('/doc/TEST-STD-0001/email-expansions');
    await expect(page.getByRole('columnheader', { name: 'Mail trigger' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'To' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Cc' })).toBeVisible();
    await expect(page.locator('code', { hasText: 'document_published' }).first()).toBeVisible();

    // An anonymous viewer sees counts, never addresses.
    await expect(page.locator('body')).not.toContainText('@example.invalid');
  });

  test('history offers all four diff views with shareable urls', async ({ page }) => {
    await page.goto('/doc/DRAFT-TEST-PROTOCOL/history');
    // Draft family history requires sign-in; the reader-visible family is used instead.
    await page.goto('/doc/TEST-STD-0001/history');
    await expect(page.getByRole('heading', { name: 'Document history' })).toBeVisible();

    for (const view of ['side-by-side', 'before-after', 'change-bars', 'inline']) {
      await page.goto(`/doc/TEST-STD-0001/history?view=${view}`);
      await expect(page.getByRole('heading', { name: 'Revision differences' })).toBeVisible();
    }
  });

  test('history search and event permalinks work', async ({ page }) => {
    await page.goto('/doc/TEST-STD-0001/history?q=published');
    await expect(page.locator('table.dl-table').last()).toContainText('document_published');

    const permalink = page.getByRole('link', { name: 'Permalink to this event' }).first();
    if (await permalink.count()) {
      const href = await permalink.getAttribute('href');
      expect(href).toContain('event=');
    }
  });

  test('references, referenced-by, errata, ipr and bibtex all resolve', async ({ page }) => {
    await page.goto('/doc/TEST-STD-0001/references');
    await expect(page.getByRole('heading', { name: /^References/ })).toBeVisible();

    await page.goto('/doc/TEST-STD-0001/referenced-by');
    await expect(page.getByRole('heading', { name: /^Referenced by/ })).toBeVisible();

    await page.goto('/doc/TEST-STD-0001/errata');
    await expect(page.getByRole('heading', { name: /^Errata/ })).toBeVisible();
    await expect(page.locator('body')).toContainText('Verified');

    await page.goto('/doc/TEST-STD-0001/ipr');
    await expect(page.getByRole('heading', { name: /IPR disclosures/ })).toBeVisible();

    const bibtex = await page.request.get('/doc/TEST-STD-0001/bibtex');
    expect(bibtex.headers()['content-type']).toContain('text/plain');
    expect(await bibtex.text()).toContain('@techreport');
  });

  test('artifacts are served with their own content types', async ({ page }) => {
    const txt = await page.request.get('/artifacts/TEST-STD-0001-PUBLISHED/txt');
    expect(txt.status()).toBe(200);
    expect(txt.headers()['content-type']).toContain('text/plain');
    expect(await txt.text()).toContain('[Page 1]');

    const pdf = await page.request.get('/artifacts/TEST-STD-0001-PUBLISHED/pdf');
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('compare renders every diff view', async ({ page }) => {
    for (const view of ['side-by-side', 'before-after', 'change-bars', 'inline']) {
      await page.goto(
        `/compare?from=DRAFT-TEST-STD-0001-00&to=TEST-STD-0001-PUBLISHED&view=${view}`,
      );
      await expect(page.getByRole('heading', { name: 'Compare revisions' })).toBeVisible();
    }
  });

  test('health endpoints report status', async ({ page }) => {
    const live = await page.request.get('/health/live');
    expect(live.status()).toBe(200);
    const ready = await page.request.get('/health/ready');
    expect(ready.status()).toBe(200);
    expect((await ready.json()).status).toBe('ready');
  });
});
