import { expect, test } from '@playwright/test';

/** Reader acceptance checks — layout, panel, contents, prefs, print. */

test.describe('reader', () => {
  test('renders a published document from local data', async ({ page }) => {
    await page.goto('/doc/html/TEST-STD-0001');
    await expect(page.locator('pre.dl-page').first()).toBeVisible();
    await expect(page.locator('pre.dl-page').first()).toContainText('Example Ledger Interchange Format');
    await expect(page.locator('pre.dl-page').first()).toContainText('[Page 1]');
  });

  test('uses the reference geometry at 1280x720 in dark mode', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop geometry only');
    await page.goto('/doc/html/TEST-STD-0001');

    const sidebar = page.locator('aside.dl-sidebar');
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(316);
    // The reference layout puts the panel flush against the right edge; the
    // absolute x depends on whether the platform reserves scrollbar space.
    const layoutWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(Math.round(box!.x + box!.width)).toBe(layoutWidth);

    const pageBox = await page.locator('pre.dl-page').first().boundingBox();
    expect(Math.round(pageBox!.width)).toBe(768);

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(33, 37, 41)');
    const border = await sidebar.evaluate((el) => getComputedStyle(el).borderLeftColor);
    expect(border).toBe('rgb(73, 80, 87)');
  });

  test('hiding the panel removes it and keeps the toggle', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop layout only');
    await page.goto('/doc/html/TEST-STD-0001');

    const toggle = page.getByRole('button', { name: /document metadata/i });
    await expect(page.locator('aside.dl-sidebar')).toBeVisible();

    await toggle.click();
    await expect(page.locator('aside.dl-sidebar')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeVisible();

    // The document reclaims the horizontal space the panel used. The layout
    // transition takes ~120ms, so poll rather than sampling mid-animation.
    await expect
      .poll(async () => (await page.locator('pre.dl-page').first().boundingBox())!.x)
      .toBeGreaterThan(200);
  });

  test('reopening the panel keeps the previously selected tab', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop layout only');
    await page.goto('/doc/html/TEST-STD-0001');

    await page.getByRole('tab', { name: 'Contents' }).click();
    await expect(page.getByRole('tab', { name: 'Contents' })).toHaveAttribute('aria-selected', 'true');

    const toggle = page.getByRole('button', { name: /document metadata/i });
    await toggle.click();
    await toggle.click();
    await expect(page.getByRole('tab', { name: 'Contents' })).toHaveAttribute('aria-selected', 'true');
  });

  test('contents navigation scrolls to the section and marks it active', async ({ page }, testInfo) => {
    // Skipped under device emulation only: Chromium reports a layout viewport
    // wider than the visual one there, which moves the panel out of reach. The
    // narrow project covers the same behaviour at 375px.
    test.skip(testInfo.project.name === 'mobile', 'covered by the narrow project');
    await page.goto('/doc/html/TEST-STD-0001');
    if ((await page.locator('aside.dl-sidebar').count()) === 0) {
      await page.getByRole('button', { name: /document metadata/i }).click();
    }
    await page.getByRole('tab', { name: 'Contents' }).click();

    const target = page.locator('.dl-contents-tree a[href="#section-3.2"]');
    await target.click();
    await page.waitForTimeout(600);

    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(100);

    const headingTop = await page.evaluate(
      () => document.getElementById('section-3.2')!.getBoundingClientRect().top,
    );
    expect(Math.abs(headingTop)).toBeLessThan(160);
    await expect(target).toHaveAttribute('aria-current', 'true');
  });

  test('scrolling the document changes the active contents entry', async ({ page }) => {
    await page.goto('/doc/html/TEST-STD-0001');
    if ((await page.locator('aside.dl-sidebar').count()) === 0) {
      await page.getByRole('button', { name: /document metadata/i }).click();
    }
    await page.getByRole('tab', { name: 'Contents' }).click();

    await page.evaluate(() => document.getElementById('section-5')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(800);
    await expect(page.locator('.dl-contents-tree a[aria-current="true"]')).toHaveAttribute(
      'href',
      /#section-(4|5|6)/,
    );
  });

  test('tabs respond to keyboard navigation', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'keyboard interaction');
    await page.goto('/doc/html/TEST-STD-0001');

    const infoTab = page.getByRole('tab', { name: 'Info' });
    await infoTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Contents' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Prefs' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
  });

  test('theme choice persists across reloads', async ({ page }) => {
    await page.goto('/doc/html/TEST-STD-0001');
    await page.getByRole('button', { name: /colour theme/i }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(255, 255, 255)');

    await page.getByRole('button', { name: /colour theme/i }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('font size preference applies within 7-16pt', async ({ page }, testInfo) => {
    // Skipped under device emulation only: Chromium reports a layout viewport
    // wider than the visual one there, which moves the panel out of reach. The
    // narrow project covers the same behaviour at 375px.
    test.skip(testInfo.project.name === 'mobile', 'covered by the narrow project');
    await page.goto('/doc/html/TEST-STD-0001');
    if ((await page.locator('aside.dl-sidebar').count()) === 0) {
      await page.getByRole('button', { name: /document metadata/i }).click();
    }
    await page.getByRole('tab', { name: 'Prefs' }).click();

    const slider = page.locator('#pref-font');
    await expect(slider).toHaveAttribute('min', '7');
    await expect(slider).toHaveAttribute('max', '16');

    await slider.fill('16');
    await expect
      .poll(async () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--dl-reader-font-size').trim(),
        ),
      )
      .toBe('16pt');
  });

  test('citation preference changes the link target', async ({ page }, testInfo) => {
    // Skipped under device emulation only: Chromium reports a layout viewport
    // wider than the visual one there, which moves the panel out of reach. The
    // narrow project covers the same behaviour at 375px.
    test.skip(testInfo.project.name === 'mobile', 'covered by the narrow project');
    await page.goto('/doc/html/TEST-STD-0001');
    if ((await page.locator('aside.dl-sidebar').count()) === 0) {
      await page.getByRole('button', { name: /document metadata/i }).click();
    }
    await expect(page.locator('a.dl-link-citation[href^="#ref-"]').first()).toHaveCount(1);

    await page.getByRole('tab', { name: 'Prefs' }).click();
    await page.locator('#pref-citations').selectOption('linked-document');
    await expect
      .poll(async () => page.locator('a.dl-link-citation[href^="/doc/html/"]').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('deep links open at the right position', async ({ page }, testInfo) => {
    // Skipped under device emulation only: Chromium reports a layout viewport
    // wider than the visual one there, which moves the panel out of reach. The
    // narrow project covers the same behaviour at 375px.
    test.skip(testInfo.project.name === 'mobile', 'covered by the narrow project');
    await page.goto('/doc/html/TEST-STD-0001#section-5');
    await page.waitForTimeout(400);
    const top = await page.evaluate(
      () => document.getElementById('section-5')!.getBoundingClientRect().top,
    );
    expect(Math.abs(top)).toBeLessThan(300);

    await page.goto('/doc/html/TEST-STD-0001#page-2');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
  });

  test('panel and toolbar are hidden in print', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'print emulation');
    await page.goto('/doc/html/TEST-STD-0001');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('aside.dl-sidebar')).toBeHidden();
    await expect(page.locator('.dl-toolbar')).toBeHidden();
    await expect(page.locator('pre.dl-page').first()).toBeVisible();
  });

  test('mobile opens the panel as a dismissible drawer', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'narrow viewport behaviour');
    await page.goto('/doc/html/TEST-STD-0001');
    await expect(page.locator('aside.dl-sidebar')).toHaveCount(0);

    await page.getByRole('button', { name: /document metadata/i }).click();
    const drawer = page.locator('aside.dl-sidebar');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('aria-modal', 'true');

    const width = (await drawer.boundingBox())!.width;
    expect(width).toBeLessThanOrEqual(360);

    await page.keyboard.press('Escape');
    await expect(page.locator('aside.dl-sidebar')).toHaveCount(0);
  });
});
