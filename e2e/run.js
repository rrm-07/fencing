// End-to-end walkthrough in a 375px phone viewport, used as a referee would:
//   1. a full 5-touch bout with names, cards, the clock, a reset and undo
//   2. a level bout going to priority
//   3. a full 5-person poule from creation to export
//   4. reload persistence and offline start
// Run with `npm run e2e`. Screenshots land in e2e/screens/.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const PORT = 8099;
const APP_URL = `http://localhost:${PORT}/`;
const shots = new URL('./screens/', import.meta.url).pathname;
await mkdir(shots, { recursive: true });

const server = spawn(process.execPath, ['scripts/serve.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({
  ...devices['iPhone SE'],
  viewport: { width: 375, height: 667 },
  acceptDownloads: true,
});
// Record haptics (Chromium in a test has no motor).
await context.addInitScript(() => {
  window.__vib = [];
  Object.defineProperty(navigator, 'vibrate', { value: (p) => (window.__vib.push(p), true), configurable: true });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let step = 0;
const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);
const shot = (name) => page.screenshot({ path: `${shots}${name}.png` });
const tap = (sel) => page.locator(sel).first().click();
const L = 'Left (red)';
const R = 'Right (green)';
const score = async (side) => Number(await page.locator(`.side.${side} .num`).textContent());
const clock = () => page.locator('.clock .time').textContent();
const touch = (side, n = 1) =>
  (async () => {
    for (let i = 0; i < n; i++) await tap(`[aria-label="Add touch ${side === 'left' ? L : R}"]`);
  })();
const waitCount = (sel, n) =>
  page.waitForFunction(([s, k]) => document.querySelectorAll(s).length === k, [sel, n], { timeout: 5000 });
const undo = () => tap('[aria-label="Undo last action"]');
const dialogButton = (text) =>
  page.locator('.modal-wrap.open').getByRole('button', { name: text, exact: true }).click();
async function rename(side, name) {
  await tap(`[aria-label="Edit ${side === 'left' ? L : R} name"]`);
  await page.locator('.modal-wrap.open input').fill(name);
  await dialogButton('Save');
}
async function keypadType(digits) {
  for (const d of digits) await dialogButton(d);
  await dialogButton('Set');
}
async function giveCard(side, kind) {
  await tap(`[aria-label="Card ${side === 'left' ? L : R}"]`);
  const btn = page.locator('.modal-wrap.open .btn').filter({ hasText: kind === 'yellow' ? /Yellow/ : /^Red Card/ });
  await btn.first().click();
}
async function waitClockBelow(ms) {
  await page.waitForFunction(
    (limit) => {
      const t = window.__piste.state.bout.timer;
      return (t.running ? t.remainingMs - (Date.now() - t.startedAt) : t.remainingMs) < limit;
    },
    ms,
    { timeout: 20000 },
  );
}

try {
  console.log('\nBout: full 5-touch bout');
  await page.goto(APP_URL);
  await page.waitForSelector('body.ready');
  await rename('left', 'Alice');
  await rename('right', 'Bea');
  assert.equal(await page.locator('.side.left .name').textContent(), 'Alice');
  log('names edited');

  await tap('.clock');
  await page.waitForTimeout(1200);
  assert.ok(await page.locator('.run-overlay').isVisible(), 'stop zone shows while running');
  await shot('01-running');
  // Tap on the left score area: must stop the clock and NOT score.
  await page.locator('.side.left .score').click({ force: true });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__piste.state.bout.timer.running), false);
  assert.equal(await score('left'), 0, 'stopping tap did not score');
  assert.match(await clock(), /^2:5\d$/);
  log(`tap-anywhere stop works, clock ${await clock()}, no stray touch`);

  await touch('left', 2);
  await touch('right', 1);
  assert.deepEqual([await score('left'), await score('right')], [2, 1]);
  log('touches 2–1');

  await giveCard('left', 'yellow');
  assert.equal(await page.locator('.side.left .c-yellow').count(), 1);
  await giveCard('left', 'yellow');
  assert.equal(await page.locator('.side.left .c-red').count(), 1, 'second yellow became red');
  assert.equal(await score('right'), 2, 'red card gave Bea a touch');
  await shot('02-cards');
  log('yellow, then second yellow → red: 2–2');

  await tap('[aria-label="Remove touch Right (green)"]');
  assert.equal(await score('right'), 1);
  await undo();
  assert.equal(await score('right'), 2);
  log('−1 and undo');

  await tap('.clock');
  await page.waitForTimeout(1100);
  await page.mouse.click(187, 300);
  await page.waitForTimeout(500);
  const before = await clock();
  await tap('[aria-label="Reset clock (press and hold)"]');
  await dialogButton('Reset');
  assert.equal(await clock(), '3:00');
  await undo();
  assert.equal(await clock(), before, 'undo restores the clock after a reset');
  log(`clock reset via confirmation, then undone back to ${before}`);

  // Press-and-hold reset.
  const reset = page.locator('[aria-label="Reset clock (press and hold)"]');
  const box = await reset.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.equal(await clock(), '3:00', 'hold resets without a dialog');
  assert.equal(await page.locator('.modal-wrap').count(), 0);
  await undo();
  log('press-and-hold reset, undone');

  await tap('[aria-label="Set exact time"]');
  await keypadType('012');
  assert.equal(await clock(), '0:12');
  await page.evaluate(() => (window.__vib = []));
  await tap('.clock');
  await waitClockBelow(9500);
  await page.waitForTimeout(150);
  assert.match(await clock(), /^\d\.\d$/, 'tenths under 10 s');
  await shot('03-tenths');
  const vib = await page.evaluate(() => window.__vib);
  assert.ok(
    vib.some((p) => Array.isArray(p) && p[0] === 120),
    `10-second buzz (got ${JSON.stringify(vib)})`,
  );
  await page.mouse.click(187, 300);
  log(`set clock to 0:12, ran under 10 s: shows ${await clock()}, buzzed at 10 s`);

  await tap('[aria-label="Swap sides"]');
  assert.equal(await page.locator('.side.left .name').textContent(), 'Bea');
  assert.equal(await page.locator('.side.right .c-red').count(), 1, 'cards travel with the fencer');
  await tap('[aria-label="Swap sides"]');
  log('swap sides and back');

  await touch('left', 3);
  assert.ok(await page.locator('.banner-over').isVisible());
  const res = await page.locator('.banner-result').textContent();
  assert.match(res, /Alice wins 5–2/);
  await shot('04-bout-over');
  log(`banner: "${res}"`);
  await page.locator('.banner').getByRole('button', { name: 'Undo' }).click();
  assert.equal(await score('left'), 4);
  await touch('left');
  await page.locator('.banner').getByRole('button', { name: 'Confirm result' }).click();
  assert.match(await page.locator('.banner-result').textContent(), /Alice won 5–2/);
  log('undo from banner, re-score, confirm');

  console.log('\nBout: priority');
  await page.locator('.banner').getByRole('button', { name: 'New bout' }).click();
  await touch('left');
  await touch('right');
  await tap('[aria-label="Set exact time"]');
  await keypadType('2');
  await tap('.clock');
  await page.waitForSelector('.banner-time', { timeout: 6000 });
  const vib2 = await page.evaluate(() => window.__vib);
  assert.ok(
    vib2.some((p) => Array.isArray(p) && p[0] === 600),
    'long buzz at 0:00',
  );
  await shot('05-time-level');
  log('time expired level: priority offered, long buzz');
  await page.locator('.banner').getByRole('button', { name: 'Draw priority' }).click();
  await page.waitForTimeout(400);
  await shot('06-priority-draw');
  await page.waitForFunction(() => window.__piste.state.bout.priority, null, { timeout: 6000 });
  const prioSide = await page.evaluate(() => window.__piste.state.bout.priority);
  assert.equal(await clock(), '1:00');
  assert.ok(await page.locator(`.side.${prioSide} .prio-badge`).isVisible());
  await shot('07-priority');
  log(`priority drawn to ${prioSide}, clock 1:00`);
  await tap('[aria-label="Set exact time"]');
  await keypadType('1');
  await tap('.clock');
  await page.waitForSelector('.banner-over', { timeout: 5000 });
  assert.match(await page.locator('.banner-kicker').textContent(), /on priority/);
  log(`time out again: ${await page.locator('.banner').innerText()}`.replace(/\s+/g, ' '));
  await page.locator('.banner').getByRole('button', { name: 'Confirm result' }).click();

  console.log('\nBout: black card and épée double');
  await page.locator('.banner').getByRole('button', { name: 'New bout' }).click();
  await tap('.format');
  await dialogButton('Sabre');
  assert.equal(await page.locator('.clock').isVisible(), false, 'sabre hides the clock');
  await page.locator('.modal-wrap.open').getByRole('switch', { name: 'Show clock in sabre' }).click();
  assert.equal(await page.locator('.clock').isVisible(), true, 'clock can be shown in sabre');
  await dialogButton('Épée');
  const sheetText = await page.locator('.modal-wrap.open').innerText();
  assert.doesNotMatch(sheetText, /\b(null|false|undefined)\b/, 'no stray values rendered');
  await shot('08a-format');
  await dialogButton('Done');
  log('sabre hides the clock (and can show it); format sheet renders cleanly');
  await tap('.double');
  assert.deepEqual([await score('left'), await score('right')], [1, 1]);
  await tap('[aria-label="Card Right (green)"]');
  const black = page.locator('.modal-wrap.open .hold');
  await page.waitForTimeout(500); // let the action sheet finish sliding in
  const bb = await black.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForSelector('.banner-over');
  assert.match(await page.locator('.banner-kicker').textContent(), /black card/);
  await shot('08-black');
  log('double 1–1, held black card ends the bout');
  await page.locator('.banner').getByRole('button', { name: 'Undo' }).click();
  assert.equal(await page.locator('.banner-over').count(), 0, 'black card undone');
  log('black card undone');

  console.log('\nPoule: 5 fencers end to end');
  await page.locator('.tabbar [data-tab="poules"]').click();
  await shot('09-poules-empty');
  await page.getByRole('button', { name: 'New poule', exact: true }).click();
  await page.locator('input[aria-label="Poule name"]').fill('Tuesday club night');
  const names = [
    ['Alice', 'Ealing'],
    ['Bea', ''],
    ['Cara', 'Salle Paul'],
    ['Dee', ''],
    ['Eve', 'Ealing'],
  ];
  for (const [n, c] of names) {
    await page.locator('input[aria-label="New fencer name"]').fill(n);
    await page.locator('input[aria-label="Club"]').fill(c);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await shot('10-create');
  await page.getByRole('button', { name: /Create Poule · 10 Bouts/ }).click();
  await page.waitForSelector('table.sheet');
  await shot('11-sheet-new');
  log('poule created with 5 fencers, 10 bouts');

  // Fence bouts through the scorer: the left fencer of each bout wins 5–(n%5).
  const order = await page.evaluate(() => {
    const p = [...window.__piste.state.poules.values()][0];
    return p.bouts.map((b) => [
      p.fencers.find((f) => f.id === b.leftId).name,
      p.fencers.find((f) => f.id === b.rightId).name,
    ]);
  });
  for (let i = 0; i < 7; i++) {
    if (i === 0) {
      // The épée bout above is still in progress: the app must ask first.
      await page.getByRole('button', { name: 'Next bout' }).click();
      assert.match(await page.locator('.modal-wrap.open h2').textContent(), /Replace the bout in progress/);
      await dialogButton('Replace');
    } else await page.locator('.banner').getByRole('button', { name: 'Next bout' }).click();
    await page.waitForSelector('.bout');
    assert.equal(await page.locator('.side.left .name').textContent(), order[i][0]);
    assert.equal(await page.locator('.side.right .name').textContent(), order[i][1]);
    if (i === 0) await shot('12-poule-bout');
    await touch('right', i % 4);
    await touch('left', 5);
    await page.locator('.banner').getByRole('button', { name: 'Confirm result' }).click();
  }
  log('7 bouts fenced via "Next bout": names prefilled, results written back');

  // The other three entered manually on the sheet.
  await page.locator('.banner').getByRole('button', { name: 'Poule sheet' }).click();
  await page.waitForSelector('table.sheet');
  await shot('13-sheet-partial');
  for (let i = 7; i < 10; i++) {
    const [a, b] = order[i];
    await page.locator(`.cell[aria-label^="${a} v ${b}:"]`).click();
    await page
      .locator('.modal-wrap.open')
      .getByRole('button', { name: `${a} 5`, exact: true })
      .click();
    for (let k = 0; k < 3; k++)
      await page
        .locator('.modal-wrap.open')
        .getByRole('button', { name: `${b} plus one` })
        .click();
    if (i === 7) await shot('14-manual-entry');
    await dialogButton('Save');
  }
  log('3 bouts entered manually from sheet cells');

  const poule = await page.evaluate(() => [...window.__piste.state.poules.values()][0]);
  assert.equal(poule.status, 'finished');
  const cells = await page.locator('table.sheet .cell').allTextContents();
  assert.equal(cells.filter((t) => /^[VD]\d$/.test(t)).length, 20, 'all 20 cells filled');
  assert.equal(cells.filter((t) => t.startsWith('V')).length, 10);
  await page.waitForSelector('.next-card.done');
  await shot('15-sheet-finished');
  await page.locator('.standings').scrollIntoViewIfNeeded();
  await shot('16-standings');
  const standings = await page.locator('.standings .row').allInnerTexts();
  log(`poule finished. Standings: ${standings.map((s) => s.replace(/\s+/g, ' ')).join(' | ')}`);

  const [csvDl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.next-card').getByRole('button', { name: 'CSV' }).click(),
  ]);
  const csv = await readFile(await csvDl.path(), 'utf8');
  assert.match(csv, /^Tuesday club night,/);
  assert.match(csv, /Bout,Left,Right,Score L,Score R,Winner/);
  const [imgDl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.next-card').getByRole('button', { name: 'Image' }).click(),
  ]);
  assert.match(imgDl.suggestedFilename(), /^tuesday-club-night-.*\.png$/);
  await imgDl.saveAs(`${shots}17-export.png`);
  log(`exported ${csvDl.suggestedFilename()} and ${imgDl.suggestedFilename()}`);

  console.log('\nHistory, persistence and offline');
  await page.locator('[aria-label="All poules"]').click();
  await page.locator('[aria-label="Actions for Tuesday club night"]').click();
  await dialogButton('Duplicate');
  await page.waitForSelector('table.sheet');
  await page.locator('[aria-label="All poules"]').click();
  await waitCount('.poule-row', 2);
  await page.locator('input[aria-label="Search poules"]').fill('copy');
  await waitCount('.poule-row', 1);
  await shot('18-history');
  await page.locator('input[aria-label="Search poules"]').fill('');
  await page.locator('[aria-label="Actions for Tuesday club night (copy)"]').click();
  await dialogButton('Delete');
  await dialogButton('Delete');
  await waitCount('.poule-row', 1);
  log('duplicate, search, delete with confirmation');

  await page.locator('.tabbar [data-tab="bout"]').click();
  // The last poule bout is still on screen, confirmed: start a free bout.
  await page.locator('.banner').getByRole('button', { name: 'New bout' }).click();
  await touch('left', 3);
  await page.reload();
  await page.waitForSelector('body.ready');
  assert.equal(await score('left'), 3, 'bout survives a reload');
  log('in-progress bout survives reload');

  await page
    .waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 })
    .catch(() => page.reload());
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 });
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('body.ready');
  assert.equal(await score('left'), 3);
  await page.locator('.tabbar [data-tab="poules"]').click();
  await waitCount('.poule-row', 1);
  await context.setOffline(false);
  log('reloads and runs fully offline');

  console.log('\nLandscape');
  await page.locator('.tabbar [data-tab="bout"]').click();
  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(200);
  const digitH = await page.locator('.side.left .num').evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  assert.ok(digitH >= 0.3 * 375, `score type ${digitH}px ≥ 30% of 375px`);
  await shot('19-landscape');
  log(`landscape score type ${Math.round(digitH)}px (${Math.round((digitH / 375) * 100)}% of height)`);

  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent && !b.closest('.modal-wrap'))
      .map((b) => ({
        t: b.textContent.trim() || b.getAttribute('aria-label'),
        h: b.getBoundingClientRect().height,
        w: b.getBoundingClientRect().width,
      }))
      .filter((b) => b.h < 55.5 || b.w < 55.5),
  );
  assert.deepEqual(small, [], 'all visible buttons are at least 56px');
  log('all visible bout-screen buttons ≥ 56px');

  assert.deepEqual(errors, [], 'no console errors');
  console.log('\nAll end-to-end checks passed.');
} catch (e) {
  await shot('zz-failure').catch(() => {});
  console.error('\nE2E FAILED:', e.message);
  if (errors.length) console.error('Page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
