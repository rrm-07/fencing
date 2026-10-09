// End-to-end test for shared poules: an organiser and two other phones
// (separate browser contexts) against the mock sharing server.
//   - organiser creates a poule and shares it with a code
//   - a parent joins by typing the code, a third phone joins via the link
//   - results entered on either side appear live on the others
//   - a result entered offline is sent when the phone reconnects
// Run with `npm run e2e`.

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const APP_PORT = 8097;
const DB_PORT = 9097;
const APP_URL = `http://localhost:${APP_PORT}/`;
const shots = new URL('./screens/', import.meta.url).pathname;
await mkdir(shots, { recursive: true });

const env = (port) => ({ env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const app = spawn(process.execPath, ['scripts/serve.js'], env(APP_PORT));
const db = spawn(process.execPath, ['scripts/mock-share-server.js'], env(DB_PORT));
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function phone(name) {
  const context = await browser.newContext({ ...devices['iPhone SE'], viewport: { width: 375, height: 667 } });
  await context.addInitScript((url) => localStorage.setItem('piste:shareDbUrl', url), `http://localhost:${DB_PORT}`);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text()) &&
      errors.push(`${name}: ${m.text()}`),
  );
  return { context, page };
}

let step = 0;
const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);
const dialogButton = (page, text) =>
  page.locator('.modal-wrap.open').getByRole('button', { name: text, exact: true }).click();
const cellText = (page, a, b) => page.locator(`.cell[aria-label^="${a} v ${b}:"]`).textContent();
const waitCell = (page, a, b, text) =>
  page.waitForFunction(
    ([a, b, t]) => document.querySelector(`.cell[aria-label^="${a} v ${b}:"]`)?.textContent === t,
    [a, b, text],
    { timeout: 8000 },
  );
async function enterResult(page, a, b, sa, sb) {
  await page.locator(`.cell[aria-label^="${a} v ${b}:"]`).click();
  const dlg = page.locator('.modal-wrap.open');
  for (let i = 0; i < sa; i++) await dlg.getByRole('button', { name: `${a} plus one` }).click();
  for (let i = 0; i < sb; i++) await dlg.getByRole('button', { name: `${b} plus one` }).click();
  await dialogButton(page, 'Save');
}

try {
  console.log('\nShared poules');
  const org = await phone('organiser');
  await org.page.goto(APP_URL);
  await org.page.waitForSelector('body.ready');
  await org.page.locator('.tabbar [data-tab="poules"]').click();
  await org.page.getByRole('button', { name: '＋ New' }).click();
  await org.page.locator('input[aria-label="Poule name"]').fill('Saturday U14');
  for (const n of ['Ana', 'Ben', 'Cal', 'Dov']) {
    await org.page.locator('input[aria-label="New fencer name"]').fill(n);
    await org.page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await org.page.getByRole('button', { name: /Create poule/ }).click();
  await org.page.waitForSelector('table.sheet');
  await org.page.locator('[aria-label="Poule actions"]').click();
  await dialogButton(org.page, 'Share with a code…');
  await dialogButton(org.page, 'Create code');
  await org.page.waitForSelector('.share-code');
  const code = (await org.page.locator('.share-code').textContent()).trim();
  assert.match(code, /^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{3}$/);
  await org.page.screenshot({ path: `${shots}s1-share-code.png` });
  await dialogButton(org.page, 'Done');
  await org.page.waitForSelector('.share-bar .dot.live', { timeout: 8000 });
  log(`organiser shared the poule: code ${code}, status Live`);

  const parent = await phone('parent');
  await parent.page.goto(APP_URL);
  await parent.page.waitForSelector('body.ready');
  await parent.page.locator('.tabbar [data-tab="poules"]').click();
  await parent.page.getByRole('button', { name: 'Join a shared poule with a code' }).click();
  await parent.page.screenshot({ path: `${shots}s2-join.png` });
  await parent.page.locator('input[aria-label="Share code"]').fill(code.toLowerCase().replace('-', ' '));
  await dialogButton(parent.page, 'Join');
  await parent.page.waitForSelector('table.sheet');
  assert.equal(await parent.page.locator('.page .topbar h1').textContent(), 'Saturday U14');
  await parent.page.waitForSelector('.share-bar .dot.live', { timeout: 8000 });
  log('parent joined by typing the code (lower case, with a space)');

  await enterResult(parent.page, 'Ana', 'Ben', 5, 2);
  await waitCell(org.page, 'Ana', 'Ben', 'V5');
  assert.equal(await cellText(org.page, 'Ben', 'Ana'), 'D2');
  log('parent entered Ana 5–2 Ben, organiser saw it live');

  // Organiser fences the next bout through the scorer.
  const next = org.page.locator('.next-card .nc-match');
  const [l, r] = [await next.locator('.l').textContent(), await next.locator('.r').textContent()];
  await org.page.getByRole('button', { name: 'Next bout ▶' }).click();
  for (let i = 0; i < 5; i++) await org.page.locator('[aria-label="Add touch Left (red)"]').click();
  await org.page.locator('.banner').getByRole('button', { name: 'Confirm result' }).click();
  await waitCell(parent.page, l, r, 'V5');
  await org.page.locator('.banner').getByRole('button', { name: 'Poule sheet' }).click();
  await org.page.waitForSelector('table.sheet');
  log(`organiser fenced ${l} v ${r} in the scorer, parent saw V5 live`);

  // Parent offline: result is kept and sent on reconnect.
  // Playwright's offline mode doesn't block localhost, so also cut the server off.
  const cut = (route) => route.abort('internetdisconnected');
  await parent.context.route(`http://localhost:${DB_PORT}/**`, cut);
  await parent.context.setOffline(true);
  await parent.page.waitForFunction(() => document.querySelector('.share-bar .dot.offline'), null, { timeout: 8000 });
  await enterResult(parent.page, 'Cal', 'Dov', 3, 5);
  await parent.page.waitForFunction(() => /1 to send/.test(document.querySelector('.share-bar')?.textContent));
  await parent.page.screenshot({ path: `${shots}s3-offline.png` });
  await org.page.waitForTimeout(800);
  assert.equal(await cellText(org.page, 'Dov', 'Cal'), '', 'not sent while offline');
  await parent.context.unroute(`http://localhost:${DB_PORT}/**`, cut);
  await parent.context.setOffline(false);
  await waitCell(org.page, 'Dov', 'Cal', 'V5');
  await parent.page.waitForFunction(() => !/to send/.test(document.querySelector('.share-bar')?.textContent), null, {
    timeout: 8000,
  });
  log('parent offline: "1 to send", delivered after reconnecting');

  // A third phone joins from the shared link.
  const third = await phone('third');
  await third.page.goto(`${APP_URL}#join/${code.replace('-', '')}`);
  await third.page.waitForSelector('table.sheet');
  await waitCell(third.page, 'Dov', 'Cal', 'V5');
  assert.equal(await cellText(third.page, 'Ana', 'Ben'), 'V5');
  log('third phone joined via the link and has all results');

  // Organiser corrects a result; everyone follows.
  await org.page.locator('.cell[aria-label^="Ana v Ben:"]').click();
  await org.page.locator('.modal-wrap.open').getByRole('button', { name: 'Ben plus one' }).click();
  await dialogButton(org.page, 'Save');
  await waitCell(parent.page, 'Ana', 'Ben', 'V5');
  await waitCell(parent.page, 'Ben', 'Ana', 'D3');
  await waitCell(third.page, 'Ben', 'Ana', 'D3');
  await org.page.screenshot({ path: `${shots}s4-organiser.png` });
  await parent.page.screenshot({ path: `${shots}s5-parent.png` });
  log('organiser corrected Ana–Ben to 5–3: updated on both other phones');

  // Unknown code.
  await third.page.locator('[aria-label="All poules"]').click();
  await third.page.getByRole('button', { name: 'Join a shared poule with a code' }).click();
  await third.page.locator('input[aria-label="Share code"]').fill('ZZZ-ZZZ');
  await dialogButton(third.page, 'Join');
  await third.page.waitForFunction(() =>
    /No poule with code ZZZZZZ/.test(document.querySelector('.toast')?.textContent),
  );
  log('unknown code gives a clear message');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nAll sharing checks passed.');
} catch (e) {
  console.error('\nSHARE E2E FAILED:', e.message, (e.stack.match(/share\.js:\d+/g) ?? []).join(' '));
  for (const ctx of browser.contexts()) {
    const dbg = await ctx
      .pages()[0]
      ?.evaluate(() =>
        [...window.__piste.state.poules.values()].map((p) => ({
          pending: p.share?.pending,
          bar: document.querySelector('.share-bar')?.textContent,
          online: navigator.onLine,
        })),
      )
      .catch((x) => x.message);
    console.error('  state:', JSON.stringify(dbg));
  }
  const all = await Promise.all(
    [...browser.contexts()].map((c) =>
      c.pages()[0]?.evaluate(() => [...window.__piste.state.poules.values()][0]?.share?.code),
    ),
  );
  if (all[0])
    console.error(
      '  server:',
      JSON.stringify(await (await fetch(`http://localhost:${DB_PORT}/poules/${all[0]}/results.json`)).json()),
    );
  const orgCells = await browser.contexts()[0].pages()[0].locator('.cell').allTextContents();
  console.error('  organiser cells:', orgCells.join('|'));
  for (const [i, ctx] of browser.contexts().entries())
    await ctx
      .pages()[0]
      ?.screenshot({ path: `${shots}zz-share-${i}.png` })
      .catch(() => {});
  if (errors.length) console.error('Page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  app.kill();
  db.kill();
}
