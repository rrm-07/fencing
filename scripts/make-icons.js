// Render app/icons/icon.svg to the PNG sizes the manifest needs.
// Run once after changing the SVG: `npm run icons` (needs Playwright's Chromium).
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const dir = new URL('../app/icons/', import.meta.url);
const svg = await readFile(new URL('icon.svg', dir), 'utf8');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
async function render(size, file, maskable = false) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons need the artwork inside the central 80% safe zone.
  const inner = maskable ? size * 0.8 : size;
  await page.setContent(`<html><body style="margin:0;background:${maskable ? '#0b0d10' : 'transparent'};display:grid;place-items:center;height:100vh">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg', '<svg width="100%" height="100%"')}</div></body></html>`);
  await page.screenshot({ path: new URL(file, dir).pathname, omitBackground: !maskable });
}
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', true);
await browser.close();
console.log('icons written');
