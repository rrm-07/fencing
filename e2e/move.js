// End-to-end: moving Piste to a new address (e.g. GitHub Pages → a
// Cloudflare domain). Two local servers stand in for the old and new
// addresses; the old one has HOME_URL pointing at the new one.
//   - a phone with poules and training bookings is offered to move them
//   - after moving, the old address just forwards (keeping #links)
//   - a phone with only bookings moves from the booking page
//   - an empty phone is forwarded straight away
// Run with `npm run e2e`.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const OLD = 8093;
const NEW = 8092;
const oldUrl = `http://localhost:${OLD}`;
const newUrl = `http://localhost:${NEW}`;
const serve = (port) =>
  spawn(process.execPath, ['scripts/serve.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const servers = [serve(OLD), serve(NEW)];
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function phone(name) {
  const context = await browser.newContext({ ...devices['iPhone SE'], viewport: { width: 375, height: 667 } });
  // No sharing server here: keep the booking page quiet.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('piste:shareDbUrl', 'http://localhost:1');
    } catch {
      /* about:blank */
    }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      !/Failed to load resource|ERR_CONNECTION_REFUSED|EventSource/.test(m.text()) &&
      errors.push(`${name}: ${m.text()}`),
  );
  return page;
}
let step = 0;
const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);
const dlg = (page, name) => page.locator('.modal-wrap.open').last().getByRole('button', { name, exact: true }).click();
const booking = { s: '2026-10-21_wed-clfc', id: 'bmove1', key: 'k'.repeat(32), name: 'Alice Martin' };

try {
  console.log('\nMoving to a new address');
  // A phone on the old address with a poule and a training booking.
  const a = await phone('organiser');
  await a.goto(`${oldUrl}/`);
  await a.waitForSelector('body.ready');
  await a.evaluate(async (b) => {
    const S = await import('./js/state.js');
    S.makePoule({ name: 'Moving Poule', fencers: ['Ana', 'Ben', 'Cal'].map((n, i) => ({ id: `mv${i}`, name: n })) });
    localStorage.setItem('piste:myBookings', JSON.stringify([b]));
    localStorage.setItem('piste:me', JSON.stringify({ name: b.name, member: 'UCL1234' }));
  }, booking);
  // The organiser sets HOME_URL (simulated with the local override).
  await a.evaluate((url) => {
    localStorage.setItem('piste:homeUrl', url);
    localStorage.setItem('piste:oldHosts', 'localhost:8093');
  }, newUrl);
  await a.reload();
  await a.waitForSelector('.modal-wrap.open .alert');
  assert.match(await a.locator('.modal-wrap.open').textContent(), /We’ve Moved.*localhost:8092/);
  await dlg(a, 'Move My Data');
  await a.waitForURL(`${newUrl}/**`);
  await a.waitForSelector('body.ready');
  await a.waitForFunction(() => /Moved 1 poule/.test(document.querySelector('.toast')?.textContent ?? ''), null, {
    timeout: 8000,
  });
  assert.ok(!a.url().includes('#move='), 'the data is cleared from the address bar');
  const there = await a.evaluate(() => ({
    poules: [...window.__piste.state.poules.values()].map((p) => p.name),
    bookings: JSON.parse(localStorage.getItem('piste:myBookings')),
    me: JSON.parse(localStorage.getItem('piste:me')),
  }));
  assert.deepEqual(there.poules, ['Moving Poule']);
  assert.deepEqual(there.bookings, [booking]);
  assert.equal(there.me.member, 'UCL1234');
  log('“Move My Data”: the poule and the booking keys arrived at the new address');

  // The old address now just forwards, keeping shared links.
  await a.goto(`${oldUrl}/#join/K7QM4X`);
  await a.waitForURL(`${newUrl}/**`);
  assert.ok(a.url().endsWith('#join/K7QM4X') || /#poules/.test(a.url()), a.url());
  log(`afterwards the old address forwards straight on (${a.url().replace(newUrl, '')})`);

  // A member with only bookings opens an old check-in link (/book/#checkin/…).
  const m = await phone('member');
  await m.goto(`${oldUrl}/about-blank-placeholder`).catch(() => {});
  await m.evaluate(
    ([b, url]) => {
      localStorage.setItem('piste:myBookings', JSON.stringify([b]));
      localStorage.setItem('piste:homeUrl', url);
      localStorage.setItem('piste:oldHosts', 'localhost:8093');
    },
    [{ ...booking, id: 'bmove2' }, newUrl],
  );
  await m.goto('about:blank'); // scanning a QR code opens a fresh page
  await m.goto(`${oldUrl}/book/#checkin/2026-10-21_wed-clfc/ABCD2345`);
  await m.waitForSelector('.modal-wrap.open .alert');
  assert.match(await m.locator('.modal-wrap.open').textContent(), /We’ve Moved/);
  await dlg(m, 'Move My Data');
  await m.waitForURL(`${newUrl}/**`);
  await m.waitForSelector('body.ready');
  await m.waitForFunction(() => document.body.dataset.main === 'book');
  const moved = await m.evaluate(() => JSON.parse(localStorage.getItem('piste:myBookings')));
  assert.equal(moved[0].id, 'bmove2');
  log('a member opening an old booking link moved their bookings and landed on the Book tab');

  // An empty phone is forwarded without asking.
  const e = await phone('empty');
  await e.addInitScript((url) => {
    localStorage.setItem('piste:homeUrl', url);
    localStorage.setItem('piste:oldHosts', 'localhost:8093');
  }, newUrl);
  await e.goto(`${oldUrl}/#join/ZZZ999`);
  await e.waitForURL(`${newUrl}/**`);
  log('a phone with nothing to move is forwarded straight away');

  // Before the new address is live, nobody is sent away.
  const d = await phone('early');
  await d.addInitScript(() => {
    try {
      localStorage.setItem('piste:homeUrl', 'http://localhost:1');
      localStorage.setItem('piste:oldHosts', 'localhost:8093');
    } catch {
      /* about:blank */
    }
  });
  await d.goto(`${oldUrl}/#join/ZZZ999`);
  await d.waitForSelector('body.ready');
  await d.waitForTimeout(800);
  assert.ok(d.url().startsWith(oldUrl), d.url());
  log('while the new address isn’t up yet, the old one keeps working as before');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nAll move checks passed.');
} catch (err) {
  console.error('\nMOVE E2E FAILED:', err.message, (err.stack.match(/move\.js:\d+/g) ?? []).join(' '));
  if (errors.length) console.error('Page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  for (const s of servers) s.kill();
}
