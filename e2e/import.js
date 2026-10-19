// End-to-end: moving the old Firebase database's data into the club
// database. An export (as from the Firebase console) is imported from
// Book → Admin, then the organiser unlocks with their existing passphrase
// and members' bookings are all there.
// Run with `npm run e2e`.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { startDb } from './db.js';
import { createOrganiserKeys, encryptFor } from '../app/book/crypto.js';

const APP_PORT = 8090;
const DB_PORT = 9090;
const APP = `http://localhost:${APP_PORT}/`;
const app = spawn(process.execPath, ['scripts/serve.js'], {
  env: { ...process.env, PORT: String(APP_PORT) },
  stdio: 'ignore',
});
const db = await startDb(DB_PORT);
console.log(`  (database: ${db.kind})`);
await new Promise((r) => setTimeout(r, 700));

// An export of the old database: organiser keys and a booking a week ahead.
const keys = await createOrganiserKeys('correct horse 42');
const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const day = new Date(`${date}T12:00:00Z`).getUTCDay();
const id = Object.entries({ 1: 'mon-clfc', 3: 'wed-mandela', 4: 'thu-mandela', 6: 'sat-mandela' }).find(
  ([d]) => Number(d) === day,
)?.[1];
const exportJson = {
  booking: {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    admin: { [keys.secret]: true },
    ...(id && {
      sessions: {
        [`${date}_${id}`]: {
          b1: { name: 'Old Member', enc: await encryptFor(keys.publicKey, 'UCL0001'), createdAt: 1 },
        },
      },
    }),
  },
};
const file = join(await mkdtemp(join(tmpdir(), 'export-')), 'piste-export.json');
await writeFile(file, JSON.stringify(exportJson));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
let step = 0;
const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);
try {
  console.log('\nImporting the old database');
  const ctx = await browser.newContext({ ...devices['iPhone SE'], viewport: { width: 375, height: 667 } });
  await ctx.addInitScript((url) => localStorage.setItem('piste:shareDbUrl', url), db.url);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${APP}#book/admin`);
  await page.waitForSelector('#view-admin input[aria-label="Organiser passphrase"]');
  await page.locator('#view-admin input[aria-label="Choose export file"]').setInputFiles(file);
  await page.locator('.modal-wrap.open').getByRole('button', { name: 'Import', exact: true }).click();
  await page.waitForFunction(() => /Old data imported/.test(document.querySelector('.toast')?.textContent ?? ''));
  assert.equal(
    await page.locator('input[aria-label="Repeat passphrase"]').count(),
    0,
    'now it asks to unlock, not set up',
  );
  log('the export was imported from Book → Admin');

  await page.locator('input[aria-label="Organiser passphrase"]').fill('correct horse 42');
  await page.locator('#view-admin').getByRole('button', { name: 'Unlock' }).click();
  await page.waitForFunction(
    () => /Organiser mode is on/.test(document.getElementById('view-admin').textContent),
    null,
    {
      timeout: 15000,
    },
  );
  log('the organiser unlocked with their existing passphrase');

  if (id) {
    await page.locator('.modebar [data-tab="book"]').click();
    await page
      .locator('.session-row')
      .filter({ hasText: /1 waiting|29 left/ })
      .first()
      .click();
    await page.waitForFunction(
      () => /No\. UCL0001/.test(document.querySelector('.modal-wrap.open')?.textContent ?? ''),
      null,
      {
        timeout: 10000,
      },
    );
    log('an old booking is there, with its membership number readable to the organiser');
  }
  const again = await fetch(`${db.url}/.import`, { method: 'POST', body: JSON.stringify(exportJson) });
  assert.equal(again.status, 409);
  log('importing again is refused (only into an empty database)');
  assert.deepEqual(errors, []);
  console.log('\nAll import checks passed.');
} catch (e) {
  console.error('\nIMPORT E2E FAILED:', e.message, (e.stack.match(/import\.js:\d+/g) ?? []).join(' '));
  process.exitCode = 1;
} finally {
  await browser.close();
  app.kill();
  db.stop();
}
