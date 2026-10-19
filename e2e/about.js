// End-to-end: the app's three tabs and the About page. An organiser edits the
// club links and adds a photo from Book → Admin; a member sees them live.
// Run with `npm run e2e`.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startDb } from './db.js';

const APP_PORT = 8098;
const DB_PORT = 9098;
const APP = `http://localhost:${APP_PORT}/`;
const shots = new URL('./screens/', import.meta.url).pathname;
await mkdir(shots, { recursive: true });
const app = spawn(process.execPath, ['scripts/serve.js'], {
  env: { ...process.env, PORT: String(APP_PORT) },
  stdio: 'ignore',
});
const db = await startDb(DB_PORT);
console.log(`  (database: ${db.kind})`);
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function phone(name) {
  const context = await browser.newContext({ ...devices['iPhone SE'], viewport: { width: 375, height: 667 } });
  await context.addInitScript((url) => {
    localStorage.setItem('piste:shareDbUrl', url);
    // Count live streams: each holds one of the ~6 connections per server.
    const ES = window.EventSource;
    window.__streams = { open: 0, max: 0 };
    window.EventSource = class extends ES {
      constructor(...a) {
        super(...a);
        window.__streams.open += 1;
        window.__streams.max = Math.max(window.__streams.max, window.__streams.open);
      }
      close() {
        if (this.readyState !== 2) window.__streams.open -= 1;
        super.close();
      }
    };
  }, db.url);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on(
    'console',
    (m) => m.type() === 'error' && !/401|Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`),
  );
  return page;
}
let step = 0;
const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);
const settle = (page) => page.waitForTimeout(500);
const top = (page) => page.locator('.modal-wrap.open').last();
const tab = (page, id) => page.locator(`.tabbar [data-main="${id}"]`).click();
const current = (page) =>
  page.evaluate(() => ({
    main: document.body.dataset.main,
    mode: document.body.dataset.tab,
    tab: document.querySelector('.tabbar [aria-current="true"]')?.dataset.main,
  }));

try {
  console.log('\nTabs and the About page');
  const member = await phone('member');
  await member.goto(APP);
  await member.waitForSelector('body.ready');
  assert.deepEqual(await current(member), { main: 'fence', mode: 'bout', tab: 'fence' });
  await member.locator('.modebar [data-tab="teams"]').click();
  await tab(member, 'book');
  await member.waitForSelector('#book .session-row');
  await tab(member, 'fence');
  await member.waitForFunction(() => document.body.dataset.main === 'fence');
  assert.equal((await current(member)).mode, 'teams', 'Fence remembers its mode');
  await tab(member, 'about');
  await member.waitForSelector('.album .slide.on');
  await member.waitForFunction(() => document.body.dataset.main === 'about');
  assert.deepEqual(await current(member), { main: 'about', mode: 'about', tab: 'about' });
  assert.equal(await member.locator('.modebar:not([hidden])').count(), 0, 'no mode row on About');
  const barH = await member.evaluate(() => document.querySelector('.bottom-bar').getBoundingClientRect().height);
  assert.ok(barH <= 60, `the bottom bar is just the tab bar on About (${barH}px)`);
  const links = await member.locator('.linktree .lt-btn b').allTextContents();
  assert.deepEqual(links.slice(0, 2), ['Book Training', 'Students’ Union Page']);
  assert.equal(
    await member.locator('[data-link="su"]').getAttribute('href'),
    'https://studentsunionucl.org/clubs-societies/fencing-club',
  );
  assert.equal(
    await member.locator('[data-link="instagram"]').getAttribute('href'),
    'https://instagram.com/uclfencing',
  );
  assert.match(
    await member.locator('[data-link="feedback"]').getAttribute('href'),
    /^https:\/\/docs\.google\.com\/forms\//,
  );
  assert.ok(
    await member.locator('img.crest').evaluate((img) => img.complete && img.naturalWidth > 0),
    'the club crest shows',
  );
  log('three tabs: Fence remembers Teams, Book shows sessions, About has the club page');

  // The album rotates on its own.
  const first = await member.locator('.album .slide.on figcaption b').textContent();
  await member.waitForFunction(
    (t) => document.querySelector('.album .slide.on figcaption b')?.textContent !== t,
    first,
    {
      timeout: 8000,
    },
  );
  log('the album rotates');

  // Organiser: set up, then edit links and add a photo.
  const org = await phone('organiser');
  await org.goto(`${APP}#book/admin`);
  await org.waitForSelector('#view-admin input[aria-label="Organiser passphrase"]');
  await org.locator('input[aria-label="Organiser passphrase"]').fill('correct horse 42');
  await org.locator('input[aria-label="Repeat passphrase"]').fill('correct horse 42');
  await org.locator('#view-admin').getByRole('button', { name: 'Set Up Bookings' }).click();
  await org.waitForFunction(() => /Club Page/.test(document.getElementById('view-admin').textContent), null, {
    timeout: 15000,
  });
  await org
    .locator('#view-admin')
    .getByRole('button', { name: /^Links/ })
    .click();
  await settle(org);
  await top(org).locator('input[aria-label="WhatsApp Community link"]').fill('https://chat.whatsapp.com/ExampleInvite');
  await top(org).locator('input[aria-label="Instagram link"]').fill('instagram.com/example_club/');
  await top(org).locator('input[aria-label="TikTok link"]').fill('not a link');
  await top(org).getByRole('button', { name: 'Save' }).click();
  await org.waitForFunction(() => /TikTok: paste the full link/.test(document.querySelector('.toast')?.textContent));
  await top(org).locator('input[aria-label="TikTok link"]').fill('');
  await top(org).getByRole('button', { name: 'Save' }).click();
  await member.waitForSelector('[data-link="whatsapp"]', { timeout: 8000 });
  assert.equal(
    await member.locator('[data-link="instagram"]').getAttribute('href'),
    'https://instagram.com/example_club/',
  );
  assert.equal(await member.locator('[data-link="tiktok"]').count(), 0, 'empty links are hidden');
  log('organiser added WhatsApp and Instagram links (a bad link was refused): members see them live');

  await org.locator('#view-admin').getByRole('button', { name: 'Photos' }).click();
  await settle(org);
  await top(org).locator('input[type="file"]').setInputFiles('app/icons/icon-512.png');
  await member.waitForSelector('.album img', { timeout: 15000 });
  await top(org)
    .locator('.row')
    .filter({ has: org.locator('img.thumb') })
    .first()
    .click();
  await settle(org);
  await org.locator('.modal-wrap.open .alert-input').fill('Club night');
  await top(org).getByRole('button', { name: 'Save' }).click();
  await member.waitForFunction(() => /Club night/.test(document.querySelector('.album')?.textContent ?? ''), null, {
    timeout: 8000,
  });
  await member.screenshot({ path: `${shots}a1-about.png` });
  log('organiser uploaded a photo (shrunk to JPEG) and captioned it: it’s in the album');

  // Tampering: changing the club page without the organiser passphrase.
  const res = await fetch(`${db.url}/club/about.json`, {
    method: 'PUT',
    body: JSON.stringify({ instagram: 'https://evil.example', op: 'x' }),
  });
  assert.equal(res.status, 401);
  log('the club page can’t be changed without the organiser passphrase');

  for (const [name, p] of [
    ['member', member],
    ['organiser', org],
  ]) {
    const { max } = await p.evaluate(() => window.__streams);
    assert.ok(max <= 5, `${name} had ${max} live streams open at once`);
  }
  await tab(member, 'fence');
  await member.waitForFunction(() => window.__streams.open === 0);
  log('never more than 5 live streams per phone, and none left open off the Book and About tabs');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nAll about checks passed.');
} catch (e) {
  console.error('\nABOUT E2E FAILED:', e.message, (e.stack.match(/about\.js:\d+/g) ?? []).join(' '));
  for (const [i, ctx] of browser.contexts().entries())
    await ctx
      .pages()[0]
      ?.screenshot({ path: `${shots}zz-about-${i}.png` })
      .catch(() => {});
  if (errors.length) console.error('Page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  app.kill();
  db.stop();
}
