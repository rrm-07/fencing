// End-to-end: an elimination tableau seeded from a poule, shared with a
// second phone (mock sharing server), fenced in the scorer and by hand,
// corrected, and exported.
// Run with `npm run e2e`.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startDb } from './db.js';

const APP_PORT = 8094;
const DB_PORT = 9094;
const APP_URL = `http://localhost:${APP_PORT}/`;
const shots = new URL('./screens/', import.meta.url).pathname;
await mkdir(shots, { recursive: true });

const env = (port) => ({ env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const app = spawn(process.execPath, ['scripts/serve.js'], env(APP_PORT));
const db = await startDb(DB_PORT);
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
  await context.addInitScript((url) => localStorage.setItem('piste:shareDbUrl', url), `http://localhost:${DB_PORT}`);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  return page;
}

let step = 0;
const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);
const settle = (page) => page.waitForTimeout(450);
const top = (page) => page.locator('.modal-wrap.open').last();
const dlg = (page, name) => top(page).getByRole('button', { name, exact: true }).click();
const boutCard = (page, n) => page.locator(`.de-bout[aria-label^="Bout ${n}:"]`);
const round = (page, label) => page.locator('.round-tabs').getByRole('button', { name: label, exact: true }).click();
async function touches(page, side, n) {
  for (let i = 0; i < n; i++)
    await page.locator(`[aria-label="Add touch ${side === 'left' ? 'Left (red)' : 'Right (green)'}"]`).click();
}

try {
  console.log('\nElimination tableau');
  const org = await phone('organiser');
  await org.goto(APP_URL);
  await org.waitForSelector('body.ready');
  // A finished poule of six: the fencer higher on the sheet wins every bout.
  await org.evaluate(async () => {
    const S = await import('./js/state.js');
    const P = await import('./js/core/poule.js');
    const names = ['Ana', 'Ben', 'Cal', 'Dov', 'Eli', 'Fay'];
    let p = P.createPoule({
      name: 'Club Poule',
      weapon: 'foil',
      fencers: names.map((n, i) => ({ id: `fx${i}`, name: n })),
    });
    for (const b of p.bouts) {
      const [l, r] = [Number(b.leftId.slice(2)), Number(b.rightId.slice(2))];
      p = P.recordResult(p, b.id, {
        leftId: b.leftId,
        rightId: b.rightId,
        scoreL: l < r ? 5 : 2,
        scoreR: l < r ? 2 : 5,
      });
    }
    S.savePoule(p);
    location.hash = `#poule/${p.id}`;
  });
  await org.waitForSelector('.next-card.done');
  await org.getByRole('button', { name: 'Elimination Tableau' }).click();
  await org.waitForSelector('input[aria-label="Tableau name"]');
  const seeds = await org.locator('.page-body .row-title').allTextContents();
  assert.ok(seeds.join(',').includes('Ana,Ben,Cal,Dov,Eli,Fay'), seeds.join(','));
  await org.locator('[aria-label="Include Fay"]').click(); // withdrawal
  await settle(org);
  assert.match(await org.locator('.page-body').textContent(), /5 fencers: a table of 8, with 3 byes/);
  await org.screenshot({ path: `${shots}d1-create.png` });
  await org.getByRole('button', { name: /Create Tableau · 5 Fencers/ }).click();
  await org.waitForSelector('.de-bout');
  log('tableau of 8 seeded from the poule (Fay withdrawn): 5 fencers, 3 byes');

  // Byes and the first bout.
  await round(org, 'QF');
  assert.equal(await org.locator('.de-bout.bye').count(), 3);
  assert.match(await org.locator('.next-card .nc-label').textContent(), /Quarter-finals · Bout 1/);
  await org.screenshot({ path: `${shots}d2-tableau.png` });
  await org.locator('.de-round').scrollIntoViewIfNeeded();
  await settle(org);
  await org.screenshot({ path: `${shots}d2b-round.png` });

  // Share it; a second phone joins by code.
  await org.locator('.share-cta').click();
  await dlg(org, 'Create Code');
  await org.waitForSelector('.share-code');
  const code = (await org.locator('.share-code').textContent()).trim();
  await settle(org);
  await dlg(org, 'Done');
  const coach = await phone('coach');
  await coach.goto(`${APP_URL}#join/${code.replace('-', '')}`);
  await coach.waitForSelector('.de-bout');
  assert.equal(await coach.locator('.large-title').textContent(), 'Club Poule · Elimination');
  log(`shared as ${code}; a coach’s phone joined and sees the tableau`);

  // Bout 1 (Dov v Eli) in the scorer: Eli wins 15–4. Bouts are to 15 in three periods.
  await org.getByRole('button', { name: 'Next Bout' }).click();
  await org.waitForSelector('.bout.de');
  assert.equal(await org.locator('.side.left .name').innerText(), 'Dov');
  assert.match(await org.locator('.format').textContent(), /Foil · 15.*Quarter-finals/);
  await touches(org, 'left', 4);
  await touches(org, 'right', 15);
  await org.locator('.banner').getByRole('button', { name: 'Confirm result' }).click();
  await org.locator('.banner').getByRole('button', { name: 'Tableau' }).click();
  await org.waitForSelector('.de-bout');
  await coach.waitForFunction(
    () => /Semi-finals · Bout 2/.test(document.querySelector('.next-card')?.textContent),
    null,
    { timeout: 8000 },
  );
  await round(coach, 'QF');
  assert.match(await boutCard(coach, 1).getAttribute('aria-label'), /Dov v Eli, 4–15/);
  log('bout 1 fenced in the scorer (Eli 15–4): the coach sees it live');

  // Semi-finals: the coach enters bout 3 (Cal beats Ben) by hand, the organiser bout 2.
  await round(coach, 'SF');
  await boutCard(coach, 3).click();
  await settle(coach);
  await top(coach).getByRole('button', { name: 'Cal 15' }).click();
  for (let i = 0; i < 11; i++) await top(coach).getByRole('button', { name: 'Ben plus one' }).click();
  await dlg(coach, 'Save');
  await org.waitForFunction(
    () => /Up next · Semi-finals · Bout 2/.test(document.querySelector('.next-card')?.textContent),
    null,
    {
      timeout: 8000,
    },
  );
  await round(org, 'SF');
  await boutCard(org, 2).click();
  await settle(org);
  await top(org).getByRole('button', { name: 'Ana 15' }).click();
  for (let i = 0; i < 12; i++) await top(org).getByRole('button', { name: 'Eli plus one' }).click();
  await dlg(org, 'Save');
  log('semi-finals entered by hand on both phones: Ana 15–12 Eli, Cal 15–11 Ben');

  // The final in the scorer from Choose Bout.
  await org.locator('.tabbar [data-tab="bout"]').click();
  await org.locator('.format').click();
  await settle(org);
  await top(org)
    .getByRole('button', { name: /Choose Bout/ })
    .click();
  await settle(org);
  await top(org).locator('[aria-label="Bout 4: Ana vs Cal"]').click();
  await org.waitForSelector('.bout.de');
  await touches(org, 'right', 9);
  await touches(org, 'left', 15);
  await org.locator('.banner').getByRole('button', { name: 'Confirm result' }).click();
  await org.locator('.banner').getByRole('button', { name: 'Tableau' }).click();
  await org.waitForSelector('.next-card.done');
  const podium = await org.locator('.podium .pod').allTextContents();
  assert.deepEqual(podium, ['1Ana', '2Cal', '3=Ben', '3=Eli']);
  await coach.waitForSelector('.next-card.done', { timeout: 8000 });
  await org.screenshot({ path: `${shots}d3-complete.png` });
  log('final from Choose Bout: Ana wins 15–9; podium Ana, Cal, Ben & Eli 3rd equal');

  const [csvDl] = await Promise.all([
    org.waitForEvent('download'),
    org.locator('.next-card').getByRole('button', { name: 'CSV' }).click(),
  ]);
  const csv = await readFile(await csvDl.path(), 'utf8');
  assert.match(csv, /Final,4,1,Ana,15,9,Cal,3,Ana/);
  assert.match(csv, /5,Dov,,4/);
  const [img] = await Promise.all([
    org.waitForEvent('download'),
    org.locator('.next-card').getByRole('button', { name: 'Image' }).click(),
  ]);
  await img.saveAs(`${shots}d4-export.png`);
  log(`exported ${csvDl.suggestedFilename()} and the results image`);

  // A correction to bout 1 changes who went through: later results are cleared everywhere.
  await round(org, 'QF');
  await boutCard(org, 1).click();
  await settle(org);
  await top(org).getByRole('button', { name: 'Dov 15' }).click();
  for (let i = 0; i < 5; i++) await top(org).getByRole('button', { name: 'Eli minus one' }).click();
  await dlg(org, 'Save');
  await org.waitForSelector('.modal-wrap.alert.open');
  assert.match(await top(org).textContent(), /2 later results will be cleared/);
  await dlg(org, 'Continue');
  await org.waitForFunction(() => /Ranking So Far/.test(document.body.textContent));
  await coach.waitForFunction(
    () => /Up next · Semi-finals · Bout 2/.test(document.querySelector('.next-card')?.textContent),
    null,
    { timeout: 8000 },
  );
  assert.match(await coach.locator('.next-card .nc-match').textContent(), /Ana.*Dov/);
  log('correcting bout 1 (Dov won) cleared the semi-final and final on both phones');

  // The tableau is listed with the poules.
  await org.locator('[aria-label="All poules"]').click();
  await org.waitForSelector('.tableau-tile');
  assert.match(
    await org
      .locator('.poule-row')
      .filter({ has: org.locator('.tableau-tile') })
      .textContent(),
    /Elimination · 2 of 4 bouts/,
  );
  await org.screenshot({ path: `${shots}d5-list.png` });
  log('listed under Poules as an elimination');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nAll tableau checks passed.');
} catch (e) {
  console.error('\nTABLEAU E2E FAILED:', e.message, (e.stack.match(/tableau\.js:\d+/g) ?? []).join(' '));
  for (const [i, ctx] of browser.contexts().entries())
    await ctx
      .pages()[0]
      ?.screenshot({ path: `${shots}zz-tableau-${i}.png` })
      .catch(() => {});
  if (errors.length) console.error('Page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  app.kill();
  db.stop();
}
