// End-to-end: the training booking page with three phones (organiser, Alice,
// Bob) against the mock sharing server.
// Run with `npm run e2e`.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startDb } from './db.js';

const APP_PORT = 8095;
const DB_PORT = 9095;
const APP = `http://localhost:${APP_PORT}/`;
const BOOK_URL = `${APP}#book`; // the Book tab
const shots = new URL('./screens/', import.meta.url).pathname;
await mkdir(shots, { recursive: true });

const env = (port) => ({ env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const app = spawn(process.execPath, ['scripts/serve.js'], env(APP_PORT));
const db = await startDb(DB_PORT);
const DB = db.url;
console.log(`  (database: ${db.kind})`);
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
const toAdmin = async (page) => (await page.locator('.modebar [data-tab="admin"]').click(), settle(page));
const toSessions = async (page) => (await page.locator('.modebar [data-tab="book"]').click(), settle(page));
const adminButton = (page, name) => page.locator('#view-admin').getByRole('button', { name }).click();
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
  await org.goto(`${APP}#book/admin`);
  await org.waitForSelector('#view-admin input[aria-label="Organiser passphrase"]');
  await org.locator('input[aria-label="Organiser passphrase"]').fill('correct horse 42');
  await org.locator('input[aria-label="Repeat passphrase"]').fill('correct horse 42');
  await org.locator('#view-admin').getByRole('button', { name: 'Set Up Bookings' }).click();
  await org.waitForFunction(
    () => /Organiser mode is on/.test(document.getElementById('view-admin').textContent),
    null,
    {
      timeout: 15000,
    },
  );
  await org.screenshot({ path: `${shots}b1-organiser.png` });
  await toSessions(org);
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

  // Organiser adds a one-off session with a coach's lesson list.
  const top = (page) => page.locator('.modal-wrap.open').last();
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(Date.now() + 86_400_000);
  await settle(org);
  await top(org).getByRole('button', { name: 'Done' }).click();
  await settle(org);
  await toAdmin(org);
  await adminButton(org, 'Add One-off Session');
  await settle(org);
  await top(org).locator('input[aria-label="Venue or title"]').fill('Open Day Bouting');
  await top(org).locator('input[aria-label="Date"]').fill(tomorrow);
  await top(org).locator('input[aria-label="Start time"]').fill('18:00');
  await top(org).locator('input[aria-label="End time"]').fill('20:00');
  await top(org).locator('input[aria-label="Places"]').fill('12');
  await top(org).getByRole('button', { name: 'Add Coach' }).click();
  await top(org).locator('input[aria-label="Coach 1"]').fill('Marc');
  await top(org).locator('input[aria-label="Lesson slots 1"]').fill('1');
  await org.screenshot({ path: `${shots}b8-add-event.png` });
  await top(org).getByRole('button', { name: 'Add', exact: true }).click();
  await settle(org);
  await toSessions(org);
  const eventRow = (page) => page.locator('.session-row').filter({ hasText: 'Open Day Bouting' }).first();
  await eventRow(alice).waitFor({ timeout: 8000 });
  assert.match(await eventRow(alice).textContent(), /One-off.*Lessons/);
  log('organiser added a one-off session with lessons from Marc: members see it live');

  // Lessons: Alice takes the one slot, Bob is reserve, Alice cancels and Bob moves up.
  await eventRow(alice).click();
  await settle(alice);
  assert.match(await top(alice).textContent(), /0 of 12 places taken/);
  await top(alice).getByRole('button', { name: 'Sign up for a lesson with Marc' }).click();
  await settle(alice);
  await top(alice).getByRole('button', { name: 'Sign Up', exact: true }).click();
  await alice.waitForFunction(() =>
    /You’re slot 1/.test(document.querySelector('.modal-wrap.open .lesson-group')?.textContent),
  );
  await eventRow(bob).click();
  await settle(bob);
  await top(bob).getByRole('button', { name: 'Join as reserve for Marc' }).click();
  await settle(bob);
  await top(bob).getByRole('button', { name: 'Sign Up', exact: true }).click();
  await bob.waitForFunction(() =>
    /You’re reserve #1/.test(document.querySelector('.modal-wrap.open .lesson-group')?.textContent),
  );
  await bob.screenshot({ path: `${shots}b9-lessons.png` });
  // Someone else's lesson can't be removed without a key.
  const lessonsNow = await (await fetch(`${DB}/booking/lessons.json`)).json();
  const [eKey] = Object.keys(lessonsNow);
  const [coachId] = Object.keys(lessonsNow[eKey]);
  const [firstId] = Object.keys(lessonsNow[eKey][coachId]);
  assert.equal(await rest('DELETE', `booking/lessons/${eKey}/${coachId}/${firstId}`), 401);
  await top(alice).getByRole('button', { name: 'Cancel My Lesson' }).click();
  await dlg(alice, 'Cancel Lesson');
  await bob.waitForFunction(
    () => /You’re slot 1/.test(document.querySelector('.modal-wrap.open .lesson-group')?.textContent),
    null,
    { timeout: 8000 },
  );
  await top(alice).getByRole('button', { name: 'Done' }).click();
  await top(bob).getByRole('button', { name: 'Done' }).click();
  log('lessons: Alice took the slot, Bob was reserve, Alice cancelled and Bob moved up');

  // Organiser changes one date only: fewer places.
  const labels = await org.locator('.session-row').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  const other = labels.find((l) => l !== label && !/Open Day/.test(l));
  await org.locator(`.session-row[aria-label="${other}"]`).first().click();
  await settle(org);
  await top(org)
    .getByRole('button', { name: /Change This Date/ })
    .click();
  await settle(org);
  await top(org).locator('input[aria-label="Places"]').fill('5');
  await top(org).getByRole('button', { name: 'Save', exact: true }).click();
  await org.waitForFunction(
    () => /of 5 places taken/.test(document.querySelector('.modal-wrap.open')?.textContent),
    null,
    {
      timeout: 8000,
    },
  );
  await top(org).getByRole('button', { name: 'Done' }).click();
  await bob.waitForFunction(
    (l) => /Changed/.test(document.querySelector(`.session-row[aria-label="${l}"]`)?.textContent),
    other,
    { timeout: 8000 },
  );
  log(`organiser changed one date (${other}) to 5 places: marked “Changed” for members`);

  // Organiser adds a weekly session: the default timetable is kept alongside it.
  const before = await bob.locator('.session-row').count();
  await toAdmin(org);
  await adminButton(org, 'Weekly Timetable');
  await settle(org);
  await org.screenshot({ path: `${shots}b10-timetable.png` });
  await top(org).getByRole('button', { name: 'Add Weekly Session' }).click();
  await settle(org);
  await top(org).locator('input[aria-label="Venue or title"]').fill('Sunday Social');
  await top(org).locator('[aria-label="Day"]').getByRole('button', { name: 'Sun' }).click();
  await top(org).locator('input[aria-label="Start time"]').fill('14:00');
  await top(org).locator('input[aria-label="End time"]').fill('16:00');
  await top(org).getByRole('button', { name: 'Add', exact: true }).click();
  // One or two new rows, depending on whether this Sunday's session is already over.
  await bob.waitForFunction(
    (n) =>
      document.querySelectorAll('.session-row').length > n &&
      [...document.querySelectorAll('.session-row')].some((r) => /Sunday Social/.test(r.textContent)),
    before,
    { timeout: 8000 },
  );
  const config = await (await fetch(`${DB}/booking/config.json`)).json();
  assert.equal(config.meta.main.seeded, true);
  assert.equal(Object.values(config.weekly).filter((w) => !w.deleted).length, 6);
  log('organiser added a weekly Sunday session (default timetable saved alongside it)');

  // Organiser deletes the one-off session.
  await top(org).locator('.row').filter({ hasText: 'Open Day Bouting' }).click();
  await settle(org);
  await top(org).getByRole('button', { name: 'Delete One-off Session' }).click();
  await dlg(org, 'Delete');
  await alice.waitForFunction(
    () => ![...document.querySelectorAll('.session-row')].some((r) => /Open Day/.test(r.textContent)),
    null,
    {
      timeout: 8000,
    },
  );
  await top(org).getByRole('button', { name: 'Done' }).click();
  await toSessions(org);
  log('organiser deleted the one-off session: gone for members');

  // Timetable changes need the organiser secret.
  assert.equal(
    await rest('PATCH', '', {
      'booking/config/events/e-hack0001': { title: 'Fake', start: '10:00', end: '11:00', date: tomorrow, op: 'o1' },
    }),
    401,
  );
  assert.equal(
    await rest('PATCH', '', {
      'booking/adminOps/cfg/o2': 'f'.repeat(64),
      'booking/config/events/e-hack0002': { title: 'Fake', start: '10:00', end: '11:00', date: tomorrow, op: 'o2' },
    }),
    401,
  );
  log('timetable tampering refused without the organiser passphrase');

  // Attendance: a one-off session happening now, so check-in is open.
  const ukNow = (ms) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(ms);
  // Starts in 20 minutes: still bookable, and check-in (from an hour before) is open.
  const startMs = Date.now() + 20 * 60_000;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(startMs);
  const startT = ukNow(startMs);
  const endT = ukNow(startMs + 60 * 60_000) > startT ? ukNow(startMs + 60 * 60_000) : '23:59';
  await settle(org);
  while (await org.locator('.modal-wrap.open').count()) {
    await top(org).getByRole('button', { name: 'Done' }).click();
    await settle(org);
  }
  await toAdmin(org);
  await adminButton(org, 'Add One-off Session');
  await settle(org);
  await top(org).locator('input[aria-label="Venue or title"]').fill('Open Bouting Night');
  await top(org).locator('input[aria-label="Date"]').fill(today);
  await top(org).locator('input[aria-label="Start time"]').fill(startT);
  await top(org).locator('input[aria-label="End time"]').fill(endT);
  await top(org).getByRole('button', { name: 'Add', exact: true }).click();
  await settle(org);
  await toSessions(org);
  const nightRow = (page) => page.locator('.session-row').filter({ hasText: 'Open Bouting Night' }).first();
  for (const [pg, who] of [
    [alice, 'Alice'],
    [bob, 'Bob'],
  ]) {
    await nightRow(pg).waitFor({ timeout: 8000 });
    await nightRow(pg).click();
    await settle(pg);
    await dlg(pg, 'Book a Place');
    await settle(pg);
    await dlg(pg, 'Book My Place');
    await pg.waitForFunction(() =>
      /You’re booked/.test(document.querySelector('.modal-wrap.open .sheet-status')?.textContent),
    );
    if (who === 'Alice') await dlg(pg, 'Done');
  }
  log('a session is on now: Alice and Bob booked it');

  // Organiser shows the check-in code at the door.
  await nightRow(org).click();
  await settle(org);
  await top(org)
    .getByRole('button', { name: /Show Check-in Code/ })
    .click();
  await org.waitForSelector('.modal-wrap.open svg.qr');
  await settle(org);
  const checkCode = (await org.locator('.modal-wrap.open .share-code').textContent()).trim();
  assert.match(checkCode, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  const keyOfNight = await (await fetch(`${DB}/booking/sessions.json`)).json();
  const sKey = Object.keys(keyOfNight).find(
    (k) =>
      k.startsWith(`${today}_e-`) && // the one-off session
      Object.values(keyOfNight[k]).some((b) => b.name === 'Bob Chen'),
  );
  await org.screenshot({ path: `${shots}b11-checkin-code.png` });
  log(`organiser shows the check-in QR code (${checkCode})`);

  // Alice scans it: her phone opens the link and checks her in.
  await alice.goto(`${APP}#checkin/${sKey}/${checkCode.replace('-', '')}`);
  await alice.waitForSelector('.modal-wrap.open .checked-alert', { timeout: 10000 });
  await settle(alice);
  await alice.screenshot({ path: `${shots}b12-checked-in.png` });
  await top(alice).getByRole('button', { name: 'Done' }).click();
  await org.waitForFunction(() => /^1 checked in/.test(document.querySelector('.qr-count')?.textContent), null, {
    timeout: 8000,
  });
  assert.match(await nightRow(alice).textContent(), /Checked in/);
  log('Alice scanned it: checked in, and the organiser’s count went up live');

  // Bob types the code; a wrong one is refused.
  await bob.locator('.modal-wrap.open').getByRole('button', { name: 'Check In' }).click();
  await settle(bob);
  await bob.locator('input[aria-label="Check-in code"]').fill('ZZZZ-ZZZZ');
  await top(bob).getByRole('button', { name: 'Check In', exact: true }).click();
  await bob.waitForFunction(() => /isn’t right/.test(document.querySelector('.toast')?.textContent), null, {
    timeout: 8000,
  });
  await bob.locator('.modal-wrap.open').getByRole('button', { name: 'Check In' }).click();
  await settle(bob);
  await bob.locator('input[aria-label="Check-in code"]').fill(checkCode.toLowerCase());
  await top(bob).getByRole('button', { name: 'Check In', exact: true }).click();
  await bob.waitForSelector('.modal-wrap.open .checked-alert', { timeout: 8000 });
  await top(bob).getByRole('button', { name: 'Done' }).click();
  await bob.waitForSelector('.modal-wrap.open .checked-in');
  await settle(bob);
  await top(bob).getByRole('button', { name: 'Done' }).click();
  log('Bob typed the code (a wrong code was refused): checked in');

  // Carol has no booking: scanning offers to book and check in.
  const carol = await phone('carol');
  await carol.goto(`${APP}#checkin/${sKey}/${checkCode.replace('-', '')}`);
  await carol.waitForSelector('.modal-wrap.open .alert', { timeout: 10000 });
  assert.match(await top(carol).textContent(), /No booking on this phone/);
  await dlg(carol, 'Book & Check In');
  await settle(carol);
  await carol.locator('input[aria-label="Full name"]').fill('Carol Diaz');
  await carol.locator('input[aria-label="Membership or student number"]').fill('UCL9999');
  await dlg(carol, 'Book My Place');
  await carol.waitForSelector('.checked-alert', { timeout: 10000 });
  log('Carol scanned without a booking: booked and checked in in one go');

  // Tampering: checking someone else in without their key, or as the organiser without the passphrase.
  const bobId = Object.entries(keyOfNight[sKey]).find(([, b]) => b.name === 'Bob Chen')[0];
  const sess = (await (await fetch(`${DB}/booking/sessions.json`)).json())[sKey];
  const someone = Object.keys(sess).find((id) => id !== bobId);
  assert.equal(
    await rest('PATCH', '', {
      [`booking/attendance/${sKey}/${someone}x`]: { present: true, how: 'self', at: { '.sv': 'timestamp' } },
      [`booking/attendProofs/${sKey}/${someone}x`]: { key: 'k'.repeat(32), code: checkCode.replace('-', '') },
    }),
    401,
  );
  assert.equal(
    await rest('PATCH', '', {
      'booking/adminOps/att/opx': 'f'.repeat(64),
      [`booking/attendance/${sKey}/${bobId}`]: { present: false, how: 'org', at: { '.sv': 'timestamp' }, op: 'opx' },
    }),
    401,
  );
  log('tampering refused: no checking others in, no fake organiser marks');

  // Organiser: un-ticks Bob (he left), adds a walk-in.
  await top(org).getByRole('button', { name: 'Done' }).click();
  await settle(org);
  await top(org).locator('[aria-label="Unmark Bob Chen as here"]').click();
  await top(org).locator('[aria-label="Mark Bob Chen as here"]').waitFor({ timeout: 8000 });
  await top(org)
    .getByRole('button', { name: /Add Walk-in/ })
    .click();
  await settle(org);
  await org.locator('input[aria-label="Walk-in name"]').fill('Wes Walker');
  await org.locator('input[aria-label="Walk-in membership number"]').fill('ucl7777');
  await dlg(org, 'Add Walk-in');
  await org.waitForFunction(() => /Walk-ins · 1/.test(document.querySelector('.modal-wrap.open')?.textContent), null, {
    timeout: 8000,
  });
  await org.waitForFunction(() => /No\. UCL7777/.test(document.querySelector('.modal-wrap.open')?.textContent));
  await org.screenshot({ path: `${shots}b13-register.png` });
  const [regDl] = await Promise.all([
    org.waitForEvent('download'),
    top(org).getByRole('button', { name: 'Export This Session (CSV)' }).click(),
  ]);
  const reg = await readFile(await regDl.path(), 'utf8');
  assert.match(reg, /Alice Martin,UCL1234,[^,]+,yes/);
  assert.match(reg, /Bob Chen,UCL5678,[^,]+,no/);
  assert.match(reg, /walk-in,1,Wes Walker,UCL7777,,yes/);
  await top(org).getByRole('button', { name: 'Done' }).click();
  log('organiser un-ticked Bob and added walk-in Wes: the register CSV says who came');

  // Attendance report.
  await toAdmin(org);
  await adminButton(org, /^Attendance/);
  await org.waitForSelector('.modal-wrap.open .stat-tiles', { timeout: 10000 });
  const stats = await org.locator('.modal-wrap.open .stat b').allTextContents();
  assert.deepEqual(stats, ['1', '67%', '1', '1'], stats.join(','));
  assert.match(await org.locator('[aria-label^="Bob Chen:"]').getAttribute('aria-label'), /came 0, 1 no-shows/);
  assert.match(await org.locator('[aria-label^="Wes Walker:"]').getAttribute('aria-label'), /came 1, 0 no-shows/);
  await settle(org);
  await org.screenshot({ path: `${shots}b14-attendance.png` });
  await top(org).getByRole('button', { name: 'Done' }).click();
  log('attendance report: 1 register, 67% of places turned up, Bob a no-show, 1 walk-in');

  // A wrong passphrase can't unlock organiser mode.
  await toAdmin(alice);
  await alice.locator('input[aria-label="Organiser passphrase"]').fill('wrong passphrase');
  await adminButton(alice, 'Unlock');
  await alice.waitForFunction(() => /Wrong passphrase/.test(document.querySelector('.toast')?.textContent), null, {
    timeout: 15000,
  });
  log('wrong passphrase refused');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nAll booking checks passed.');
} catch (e) {
  console.error('\nBOOK E2E FAILED:', e.message, (e.stack.match(/book\.js:\d+/g) ?? []).join(' '));
  for (const ctx of browser.contexts()) {
    const txt = await ctx
      .pages()[0]
      ?.evaluate(() => [
        ...[...document.querySelectorAll('.modal-wrap.open')].map((m) => m.textContent.slice(0, 600)),
        `toast: ${document.querySelector('.toast')?.textContent ?? ''}`,
      ])
      .catch(() => null);
    if (txt?.length) console.error('  open sheets:', JSON.stringify(txt));
  }
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
  db.stop();
}
