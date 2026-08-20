/**
 * Captures the delivery screenshots into docs/screenshots.
 *
 * Usage: node scripts/screenshots.mjs [baseUrl]
 * Expects a running instance with the seeded fixtures.
 */
import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const OUT = 'docs/screenshots';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

async function withPage(fn, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: 'dark',
    ...options,
  });
  const page = await context.newPage();
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

async function signIn(page, handle) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="password"]', 'draftledger');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/workspace/);
}

async function openPanel(page, tab) {
  if ((await page.locator('aside.dl-sidebar').count()) === 0) {
    await page.getByRole('button', { name: /document metadata/i }).click();
  }
  if (tab) await page.getByRole('tab', { name: tab }).click();
  await page.waitForTimeout(250);
}

const shots = [
  ['01-reader-dark-info', async (page) => {
    await page.goto(`${BASE}/doc/html/TEST-STD-0001`);
    await openPanel(page, 'Info');
  }],
  ['02-reader-dark-contents', async (page) => {
    await page.goto(`${BASE}/doc/html/TEST-STD-0001`);
    await openPanel(page, 'Contents');
  }],
  ['03-reader-dark-prefs', async (page) => {
    await page.goto(`${BASE}/doc/html/TEST-STD-0001`);
    await openPanel(page, 'Prefs');
  }],
  ['04-reader-panel-closed', async (page) => {
    await page.goto(`${BASE}/doc/html/TEST-STD-0001`);
    await openPanel(page);
    await page.getByRole('button', { name: /document metadata/i }).click();
    await page.waitForTimeout(300);
  }],
  ['06-status-timeline', async (page) => {
    await page.goto(`${BASE}/doc/TEST-STD-0001`);
  }],
  ['07-email-expansions', async (page) => {
    await page.goto(`${BASE}/doc/TEST-STD-0001/email-expansions`);
  }],
  ['08-history', async (page) => {
    await page.goto(`${BASE}/doc/TEST-STD-0001/history`);
  }],
  ['09-diff-side-by-side', async (page) => {
    await page.goto(`${BASE}/compare?from=DRAFT-TEST-STD-0001-00&to=TEST-STD-0003-PUBLISHED&view=side-by-side`);
  }],
  ['10-diff-before-after', async (page) => {
    await page.goto(`${BASE}/compare?from=DRAFT-TEST-STD-0001-00&to=TEST-STD-0003-PUBLISHED&view=before-after`);
  }],
  ['11-diff-change-bars', async (page) => {
    await page.goto(`${BASE}/compare?from=DRAFT-TEST-STD-0001-00&to=TEST-STD-0003-PUBLISHED&view=change-bars`);
  }],
  ['12-diff-inline', async (page) => {
    await page.goto(`${BASE}/compare?from=DRAFT-TEST-STD-0001-00&to=TEST-STD-0003-PUBLISHED&view=inline`);
  }],
  ['15-search', async (page) => {
    await page.goto(`${BASE}/`);
  }],
  ['16-errata', async (page) => {
    await page.goto(`${BASE}/doc/TEST-STD-0001/errata`);
  }],
];

for (const [name, run] of shots) {
  await withPage(async (page) => {
    await run(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    console.log('captured', name);
  });
}

// Light theme reader.
await withPage(async (page) => {
  await page.goto(`${BASE}/doc/html/TEST-STD-0001`);
  await page.getByRole('button', { name: /colour theme/i }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05-reader-light.png` });
  console.log('captured 05-reader-light');
}, { colorScheme: 'light' });

// Authenticated screens.
await withPage(async (page) => {
  await signIn(page, 'author-1');
  await page.goto(`${BASE}/drafts/DRAFT-TEST-PROTOCOL/edit`);
  await page.waitForSelector('.dl-preview pre.dl-page');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/13-draft-workspace-editor.png` });
  console.log('captured 13-draft-workspace-editor');

  await page.goto(`${BASE}/drafts/DRAFT-TEST-PROTOCOL/reviews`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/14-review-threads.png` });
  console.log('captured 14-review-threads');

  await page.goto(`${BASE}/drafts/DRAFT-TEST-PROTOCOL/publish`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/17-publish-gates.png` });
  console.log('captured 17-publish-gates');

  await page.goto(`${BASE}/workspace`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/18-workspace.png` });
  console.log('captured 18-workspace');
});

await withPage(async (page) => {
  await signIn(page, 'admin-1');
  await page.goto(`${BASE}/admin/notification-policies`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/19-admin-notification-policies.png` });
  console.log('captured 19-admin-notification-policies');
});

// Narrow-screen drawer.
await withPage(async (page) => {
  await page.goto(`${BASE}/doc/html/TEST-STD-0001`);
  await page.getByRole('button', { name: /document metadata/i }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/20-mobile-drawer.png` });
  console.log('captured 20-mobile-drawer');
}, { ...devices['Pixel 5'], colorScheme: 'dark' });

await browser.close();
console.log('screenshots written to', OUT);
