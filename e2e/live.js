// End-to-end: the app as it runs live — app and club database on one
// address (/db), with the offline cache (service worker) active. Set up
// bookings, reload, then book a place and see it after another reload.
//   default: scripts/serve.js (app + database in Node)
//   E2E_DB=cloudflare: the whole site in Cloudflare's runtime (wrangler dev)
// Run with `npm run e2e`.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const PORT = 8089;
const APP = `http://localhost:${PORT}/`;
let proc;
if (process.env.E2E_DB === 'cloudflare') {
  const bin = process.env.WRANGLER_BIN ?? 'npx';
  const state = await mkdtemp(join(tmpdir(), 'piste-live-'));
  proc = spawn(
    bin,
    [
      ...(bin === 'npx' ? ['--yes', 'wrangler@4'] : []),
      'dev',
      '--port',
      String(PORT),
      '--ip',
      'localhost',
      '--persist-to',
      state,
      '--log-level',
      'error',
    ],
    { stdio: 'ignore' },
  );
} else
  proc = spawn(process.execPath, ['scripts/serve.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
for (let i = 0; i < 120; i++) {
  try {
    await fetch(`${APP}db/club.json`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
let step = 0;
const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);
try {
  console.log(`\nThe live setup (${process.env.E2E_DB === 'cloudflare' ? 'Cloudflare runtime' : 'local server'})`);
  const ctx = await browser.newContext({ ...devices['iPhone SE'], viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${APP}#book`);
  await page.waitForSelector('body.ready');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  log('the offline cache is in control');

  await page.goto(`${APP}#book/admin`);
  await page.waitForSelector('#view-admin input[aria-label="Organiser passphrase"]');
  await page.locator('input[aria-label="Organiser passphrase"]').fill('test passphrase 1!');
  await page.locator('input[aria-label="Repeat passphrase"]').fill('test passphrase 1!');
  await page.locator('#view-admin').getByRole('button', { name: 'Set Up Bookings' }).click();
  await page.waitForFunction(
    () => /Organiser mode is on/.test(document.getElementById('view-admin').textContent),
    null,
    {
      timeout: 20000,
    },
  );
  log('set up bookings with a passphrase');

  await page.reload();
  await page.waitForSelector('#view-admin input[aria-label="Organiser passphrase"]');
  assert.equal(
    await page.locator('input[aria-label="Repeat passphrase"]').count(),
    0,
    'asks to unlock, not set up again',
  );
  log('after a reload it asks to unlock, not to set up again (nothing stale from the cache)');

  await page.goto(`${APP}#book`);
  await page.locator('.session-row .tag-next').first().waitFor({ timeout: 10000 });
  await page
    .locator('.session-row')
    .filter({ has: page.locator('.tag-next') })
    .first()
    .click();
  await page.locator('.modal-wrap.open').getByRole('button', { name: 'Book a Place' }).click();
  await page.waitForTimeout(400);
  await page.locator('input[aria-label="Full name"]').fill('Live Tester');
  await page.locator('input[aria-label="Membership or student number"]').fill('UCL4242');
  await page.locator('.modal-wrap.open').getByRole('button', { name: 'Book My Place' }).click();
  await page.waitForFunction(() =>
    document.querySelector('.modal-wrap.open .sheet-status')?.textContent.includes('You’re booked'),
  );
  await page.reload();
  await page.waitForSelector('.session-row .tag-green', { timeout: 10000 });
  log('booked a place; still booked after a reload');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nAll live checks passed.');
} catch (e) {
  console.error('\nLIVE E2E FAILED:', e.message, (e.stack.match(/live\.js:\d+/g) ?? []).join(' '));
  if (errors.length) console.error('Page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  proc.kill();
}
