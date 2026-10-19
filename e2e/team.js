// End-to-end: a full team relay match in a 375px phone viewport.
//   - create two teams of three (+ reserve)
//   - fence legs in the scorer: score carries over, team cards carry over,
//     a leg ends on time, a leg is picked from "Choose Bout"
//   - enter a leg by hand, bring on the reserve, win at 45
//   - export CSV and image
// Run with `npm run e2e`.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const PORT = 8096;
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
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let step = 0;
const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);
const shot = async (name) => (await page.waitForTimeout(450), page.screenshot({ path: `${shots}${name}.png` }));
const dlg = (text) => page.locator('.modal-wrap.open').getByRole('button', { name: text, exact: true }).click();
const score = async (side) => Number(await page.locator(`.side.${side} .num`).textContent());
const touch = async (side, n) => {
  for (let i = 0; i < n; i++)
    await page.locator(`[aria-label="Add touch ${side === 'left' ? 'Left (red)' : 'Right (green)'}"]`).click();
};
const banner = (name) => page.locator('.banner').getByRole('button', { name });
async function fenceLeg(a, b) {
  await page.waitForSelector('.bout');
  await touch('right', b);
  await touch('left', a);
  await page.waitForSelector('.banner-over');
}

try {
  console.log('\nTeam match');
  await page.goto(APP_URL);
  await page.waitForSelector('body.ready');
  await page.locator('.modebar [data-tab="teams"]').click();
  await page.getByRole('button', { name: 'New team match', exact: true }).click();
  const fill = (label, v) => page.locator(`input[aria-label="${label}"]`).fill(v);
  await fill('Team A name', 'Ealing');
  await fill('Team B name', 'Salle Paul');
  for (const [i, n] of ['Ann', 'Bob', 'Cat'].entries()) await fill(`Team A fencer ${i + 1}`, n);
  for (const [i, n] of ['Dan', 'Eve', 'Fay'].entries()) await fill(`Team B fencer ${i + 1}`, n);
  await fill('Team A reserve', 'Rae');
  await page.getByRole('button', { name: /Create Match · 9 Legs to 45/ }).click();
  await page.waitForSelector('.scoreboard');
  log('match created: Ealing v Salle Paul, 9 legs');

  // Leg 1 (Cat v Fay, to 5) with a yellow for Ealing.
  await page.getByRole('button', { name: 'Next Leg' }).click();
  await page.waitForSelector('.bout');
  assert.equal(await page.locator('.side.left .name').innerText(), 'Cat');
  assert.equal(await page.locator('.side.right .name').innerText(), 'Fay');
  await page.locator('[aria-label="Card Left (red)"]').click();
  await page
    .locator('.modal-wrap.open .action-btn')
    .filter({ hasText: /Yellow Card/ })
    .click();
  await fenceLeg(5, 2);
  assert.match(await page.locator('.banner-kicker').textContent(), /Leg 1 of 9 over/);
  await shot('t1-leg-over');
  await banner('Confirm leg').click();
  log('leg 1: Cat 5–2 Fay, with a team yellow card');

  // Leg 2 (Ann v Eve, to 10): starts at 5–2; a second Ealing yellow is red.
  await banner('Next leg').click();
  await page.waitForSelector('.bout:not(.status-confirmed)');
  assert.deepEqual([await score('left'), await score('right')], [5, 2]);
  await page.locator('[aria-label="Remove touch Left (red)"]').click();
  assert.equal(await score('left'), 5, '−1 cannot go below the carried score');
  await page.locator('[aria-label="Card Left (red)"]').click();
  await page
    .locator('.modal-wrap.open .action-btn')
    .filter({ hasText: /Yellow → Red Card/ })
    .click();
  assert.equal(await score('right'), 3, 'team card carried over: second yellow gave a touch');
  await fenceLeg(5, 0);
  await banner('Confirm leg').click();
  log('leg 2 starts at 5–2; second team yellow became a red; 10–3');

  // Leg 3 (Bob v Dan): ends on time, level for the leg.
  await banner('Next leg').click();
  await page.waitForSelector('.bout:not(.status-confirmed)');
  await page.locator('[aria-label="Set exact time"]').click();
  await dlg('2');
  await dlg('Set');
  await page.locator('.clock').click();
  await page.waitForSelector('.banner-over', { timeout: 6000 });
  assert.match(await page.locator('.banner-kicker').textContent(), /Leg 3 of 9 over · on time/);
  await banner('Confirm leg').click();
  log('leg 3 ended on time with no touches: still 10–3');

  // Leg 4 picked from the Bout tab's "Choose Bout".
  await page.locator('.format').click();
  await page.waitForTimeout(450);
  await page
    .locator('.modal-wrap.open')
    .getByRole('button', { name: /Choose Bout/ })
    .click();
  await page.waitForTimeout(450);
  await shot('t2-choose-leg');
  await page.locator('.modal-wrap.open [aria-label^="Leg 4:"]').click();
  await page.waitForSelector('.bout:not(.status-confirmed)');
  await fenceLeg(10, 0);
  await banner('Confirm leg').click();
  log('leg 4 chosen from "Choose Bout": 20–3');

  // Leg 5 by hand from the match sheet, then bring on the reserve.
  await banner('Match').click();
  await page.waitForSelector('.scoreboard');
  await page.locator('.leg-row').nth(4).click();
  for (let i = 0; i < 5; i++)
    await page.locator('.modal-wrap.open').getByRole('button', { name: 'Cat plus one' }).click();
  await page.locator('.modal-wrap.open').getByRole('button', { name: 'Dan plus one' }).click();
  await shot('t3-leg-entry');
  await dlg('Save');
  await page.locator('[aria-label="Match actions"]').click();
  await dlg('Bring On Reserve…');
  await dlg('Cat');
  await page.waitForFunction(() => document.querySelectorAll('.leg-row')[8]?.textContent.includes('Rae'));
  log('leg 5 entered by hand (25–4); reserve Rae replaces Cat for leg 9');

  // Legs 6–9 in the scorer; Ealing reaches 45.
  await page.getByRole('button', { name: 'Next Leg' }).click();
  for (let n = 6; n <= 9; n++) {
    if (n > 6) await banner('Next leg').click();
    await fenceLeg(5, n === 6 ? 2 : 0);
    if (n < 9) await banner('Confirm leg').click();
  }
  assert.match(await page.locator('.banner-kicker').textContent(), /Match over/);
  assert.match(await page.locator('.banner-result').textContent(), /Ealing win 45–6/);
  await shot('t4-match-over');
  await banner('Confirm result').click();
  assert.match(await page.locator('.banner-result').textContent(), /Ealing won 45–6/);
  log('Ealing win 45–6 at the end of leg 9 (fenced by the reserve)');

  await banner('Match').click();
  await page.waitForSelector('.scoreboard');
  assert.match(await page.locator('.nc-winner').textContent(), /Ealing win/);
  await shot('t5-match-sheet');
  await page.locator('.page-body').evaluate((e) => (e.scrollTop = 900));
  await shot('t6-match-sheet-2');

  const [csvDl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const csv = await readFile(await csvDl.path(), 'utf8');
  assert.match(csv, /Result,Ealing 45–6 Salle Paul/);
  assert.match(csv, /Winner,Ealing/);
  assert.match(csv, /9,45,Rae,Eve,5,0,45,6/);
  const [imgDl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Share Image' }).click(),
  ]);
  await imgDl.saveAs(`${shots}t7-team-export.png`);
  log(`exported ${csvDl.suggestedFilename()} and ${imgDl.suggestedFilename()}`);

  await page.locator('[aria-label="All team matches"]').click();
  await page.waitForSelector('.match-open');
  assert.match(await page.locator('.match-open').first().textContent(), /Ealing won/);
  log('match listed under Finished');

  // Three-weapon fixture: 3 + reserve per weapon per team.
  await page.getByRole('button', { name: 'New team match', exact: true }).click();
  await page.locator('[aria-label="Format"]').getByRole('button', { name: 'All Three Weapons' }).click();
  await fill('Team A name', 'UCL');
  await fill('Team B name', 'KCL');
  const W = { Foil: 'F', Épée: 'E', Sabre: 'S' };
  for (const [w, c] of Object.entries(W)) {
    for (const i of [1, 2, 3]) {
      await fill(`${w} team A fencer ${i}`, `U${c}${i}`);
      await fill(`${w} team B fencer ${i}`, `K${c}${i}`);
    }
    await fill(`${w} team A reserve`, `U${c}R`);
  }
  await shot('t8-fixture-form');
  await page.getByRole('button', { name: /Create Fixture · 3 Weapons/ }).click();
  await page.waitForSelector('.weapon-row');
  assert.equal(await page.locator('.weapon-row').count(), 3);
  log('three-weapon fixture created: UCL v KCL, 9 fencers + 3 reserves each');

  // Win foil and épée by entering leg 1 by hand (to 45 for the test).
  async function winWeapon(w, a) {
    await page.locator(`.weapon-row[aria-label^="${w} "]`).click();
    await page.waitForSelector('.weapon-switch');
    await page.locator('.leg-row').first().click();
    for (let i = 0; i < 45; i++)
      await page
        .locator('.modal-wrap.open')
        .getByRole('button', { name: `${a} plus one` })
        .click();
    await dlg('Save');
    await page.waitForSelector('.nc-winner');
  }
  await winWeapon('Foil', 'UF3');
  // Switch weapon from the match page.
  await page.locator('.weapon-switch').getByRole('button', { name: 'Épée' }).click();
  await page.waitForFunction(() => /Épée/.test(document.querySelector('.summary-line')?.textContent));
  await page.locator('[aria-label="Back to the fixture"]').click();
  await winWeapon('Épée', 'UE3');
  await page.locator('[aria-label="Back to the fixture"]').click();
  await page.waitForSelector('.weapon-row');
  assert.match(await page.locator('.nc-winner').textContent(), /UCL have won the fixture/);
  assert.deepEqual(await page.locator('.sb-score').allTextContents(), ['2', '0']);
  assert.match(await page.locator('.sb-caption').textContent(), /touches 90–0/);
  await shot('t9-fixture');
  log('UCL won foil and épée: fixture won 2–0 on weapons (touches 90–0)');

  const [fxCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const fcsv = await readFile(await fxCsv.path(), 'utf8');
  assert.match(fcsv, /Weapons won,UCL 2–0 KCL/);
  assert.match(fcsv, /Sabre,0,0,/);
  assert.match(fcsv, /US1/);
  const [fxImg] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Share Image' }).click(),
  ]);
  await fxImg.saveAs(`${shots}t10-fixture-export.png`);
  log(`fixture exported: ${fxCsv.suggestedFilename()}`);

  await page.locator('[aria-label="All team matches"]').click();
  await page.waitForSelector('.fixture-tile');
  assert.match(await page.locator('.match-open').first().textContent(), /UCL have won/);
  await page.locator('[aria-label="Actions for UCL v KCL"]').click();
  await dlg('Delete');
  await dlg('Delete');
  await page.waitForFunction(() => !document.querySelector('.fixture-tile'));
  assert.equal(await page.evaluate(() => window.__piste.state.matches.size), 1);
  log('fixture listed as one entry; deleting it removes all three weapons');

  assert.deepEqual(errors, [], 'no console errors');
  console.log('\nAll team checks passed.');
} catch (e) {
  await page.screenshot({ path: `${shots}zz-team-failure.png` }).catch(() => {});
  console.error('\nTEAM E2E FAILED:', e.message, (e.stack.match(/team\.js:\d+/g) ?? []).join(' '));
  if (errors.length) console.error('Page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
