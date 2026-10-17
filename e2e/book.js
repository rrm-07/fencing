// End-to-end: the training booking page with three phones (organiser, Alice,
// Bob) against the mock sharing server.
// Run with `npm run e2e`.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const APP_PORT = 8095;
const DB_PORT = 9095;
const BOOK_URL = `http://localhost:${APP_PORT}/book/`;
const DB = `http://localhost:${DB_PORT}`;
const shots = new URL('./screens/', import.meta.url).pathname;
await mkdir(shots, { recursive: true });

const env = (port) => ({ env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const app = spawn(process.execPath, ['scripts/serve.js'], env(APP_PORT));
const db = spawn(process.execPath, ['scripts/mock-share-server.js'], env(DB_PORT));
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function phone(name) {
  const context = await browser.newContext({
    ...devices['iPhone SE'],
    viewport: { width: 375, height: 667 },
    acceptDownloads: true,
  });
  await context.addInitScript((url) => localStorage.setItem('piste:shareDbUrl', url), DB);
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
const dlg = (page, name) => page.locator('.modal-wrap.open').getByRole('button', { name, exact: true }).click();
const rest = async (method, path, body) => {
  const res = await fetch(`${DB}/${path}.json`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return res.status;
};

try {
  console.log('\nTraining bookings');
  // Organiser sets up bookings.
  const org = await phone('organiser');
  await org.goto(`${BOOK_URL}#organiser`);
  await org.waitForSelector('.modal-wrap.open input[aria-label="Organiser passphrase"]');
  await org.locator('input[aria-label="Organiser passphrase"]').fill('correct horse 42');
  await org.locator('input[aria-label="Repeat passphrase"]').fill('correct horse 42');
  await dlg(org, 'Set Up Bookings');
  await org.waitForSelector('.org-on', { timeout: 15000 });
  await org.screenshot({ path: `${shots}b1-organiser.png` });
  log('organiser set up bookings with a passphrase');

  // Alice books the first session that hasn't started.
  const alice = await phone('alice');
  await alice.goto(BOOK_URL);
  await alice.waitForSelector('.session-row .tag-next');
  await settle(alice);
  await alice.screenshot({ path: `${shots}b2-list.png` });
  const target = alice
    .locator('.session-row')
    .filter({ has: alice.locator('.tag-next') })
    .first();
  const label = await target.getAttribute('aria-label');
  await target.click();
  await settle(alice);
  await alice.screenshot({ path: `${shots}b3-session.png` });
  await dlg(alice, 'Book a Place');
  await settle(alice);
  await alice.locator('input[aria-label="Full name"]').fill('Alice Martin');
  await alice.locator('input[aria-label="Membership or student number"]').fill('ucl1234');
  await alice.screenshot({ path: `${shots}b4-form.png` });
  await dlg(alice, 'Book My Place');
  await alice.waitForFunction(() =>
    document.querySelector('.modal-wrap.open .sheet-status')?.textContent.includes('You’re booked'),
  );
  await dlg(alice, 'Done');
  await alice.waitForSelector('.tag-green');
  log(`Alice booked: ${label}`);

  const sessionKey = await alice.evaluate(() => Object.keys(window.__book.sessions)[0]);
  const stored = JSON.stringify(await (await fetch(`${DB}/booking/sessions.json`)).json());
  assert.ok(stored.includes('Alice Martin') && !stored.includes('UCL1234'), 'name public, number encrypted');
  log('server holds her name but only an encrypted membership number');

  // Fill the session to 30 directly, as other members would.
  for (let i = 1; i < 30; i++) {
    const id = `bseed${String(i).padStart(2, '0')}`;
    const status = await rest('PATCH', '', {
      [`booking/sessions/${sessionKey}/${id}`]: { name: `Member ${i}`, enc: 'x', createdAt: { '.sv': 'timestamp' } },
      [`booking/keys/${sessionKey}/${id}/k${'0'.repeat(30)}${i}`]: true,
    });
    assert.equal(status, 200);
  }

  // Bob gets the waitlist.
  const bob = await phone('bob');
  await bob.goto(BOOK_URL);
  await bob.waitForSelector('.session-row');
  await bob.locator(`.session-row[aria-label="${label}"]`).first().click();
  await settle(bob);
  await dlg(bob, 'Join the Waitlist');
  await settle(bob);
  await bob.locator('input[aria-label="Full name"]').fill('Bob Chen');
  await bob.locator('input[aria-label="Membership or student number"]').fill('UCL5678');
  await dlg(bob, 'Add Me to the Waitlist');
  await bob.waitForFunction(() =>
    /#1 on the waitlist/.test(document.querySelector('.modal-wrap.open .sheet-status')?.textContent),
  );
  await bob.screenshot({ path: `${shots}b5-waitlist.png` });
  await dlg(bob, 'Done');
  log('session full at 30: Bob is #1 on the waitlist');

  // Tampering is refused: deleting someone else's booking, faking a cancel key, closing without the organiser secret.
  assert.equal(await rest('DELETE', `booking/sessions/${sessionKey}/bseed01`), 401);
  assert.equal(
    await rest('PATCH', '', {
      [`booking/sessions/${sessionKey}/bseed01`]: null,
      [`booking/cancels/${sessionKey}/bseed01`]: 'guess'.repeat(5),
    }),
    401,
  );
  assert.equal(
    await rest('PATCH', '', {
      [`booking/adminOps/close/${sessionKey}/cX`]: 'f'.repeat(64),
      [`booking/closures/${sessionKey}/cX`]: { closed: true, at: { '.sv': 'timestamp' } },
    }),
    401,
  );
  log('tampering refused: no deleting others’ bookings, no fake organiser actions');

  // Alice cancels: Bob moves up.
  await alice.locator(`.session-row[aria-label="${label}"]`).first().click();
  await settle(alice);
  await dlg(alice, 'Cancel My Booking');
  await dlg(alice, 'Cancel Booking');
  await settle(alice);
  await dlg(alice, 'Done');
  await bob.waitForSelector('.session-row .tag-green', { timeout: 8000 });
  log('Alice cancelled; Bob moved from the waitlist to booked, live');

  // Organiser: sees decrypted numbers, removes a booking, cancels the session.
  await org.locator(`.session-row[aria-label="${label}"]`).first().click();
  await org.waitForFunction(() => /No\. UCL5678/.test(document.querySelector('.modal-wrap.open')?.textContent));
  await org.screenshot({ path: `${shots}b6-organiser-session.png` });
  const trash = org.locator('.modal-wrap.open [aria-label="Remove Member 1"]');
  await trash.scrollIntoViewIfNeeded();
  await settle(org);
  const box = await trash.boundingBox();
  await org.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await org.mouse.down();
  await org.waitForTimeout(900);
  await org.mouse.up();
  await org.waitForFunction(() => !document.querySelector('.modal-wrap.open [aria-label="Remove Member 1"]'), null, {
    timeout: 8000,
  });
  log('organiser sees Bob’s number (UCL5678) and removed a booking');

  const [csvDl] = await Promise.all([
    org.waitForEvent('download'),
    org.locator('.modal-wrap.open').getByRole('button', { name: 'Export This Session (CSV)' }).click(),
  ]);
  const csv = await readFile(await csvDl.path(), 'utf8');
  assert.match(csv, /Bob Chen,UCL5678/);
  assert.doesNotMatch(csv, /Alice Martin/);
  log(`register exported: ${csvDl.suggestedFilename()}`);

  await org.locator('.modal-wrap.open').getByRole('button', { name: 'Cancel Session…' }).click();
  await org.locator('.modal-wrap.open input').last().fill('Venue closed');
  await dlg(org, 'Cancel Session');
  await bob.waitForSelector('.session-row .tag-red', { timeout: 8000 });
  await bob.screenshot({ path: `${shots}b7-cancelled.png` });
  log('organiser cancelled the session: members see “Cancelled”');

  // A wrong passphrase can't unlock organiser mode.
  await alice.locator('[aria-label="Organiser"]').click();
  await settle(alice);
  await alice.locator('input[aria-label="Organiser passphrase"]').fill('wrong passphrase');
  await dlg(alice, 'Unlock');
  await alice.waitForFunction(() => /Wrong passphrase/.test(document.querySelector('.toast')?.textContent), null, {
    timeout: 15000,
  });
  log('wrong passphrase refused');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nAll booking checks passed.');
} catch (e) {
  console.error('\nBOOK E2E FAILED:', e.message, (e.stack.match(/book\.js:\d+/g) ?? []).join(' '));
  for (const [i, ctx] of browser.contexts().entries())
    await ctx
      .pages()[0]
      ?.screenshot({ path: `${shots}zz-book-${i}.png` })
      .catch(() => {});
  if (errors.length) console.error('Page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  app.kill();
  db.kill();
}
