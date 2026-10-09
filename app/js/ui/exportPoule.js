// Poule exports: CSV file, shareable PNG image and a printable page.

import { h, fill, download, toast } from './dom.js';
import { toCsv, stats, ranking, rankLabel, cellText, formatVM, fencerById, progress } from '../core/poule.js';
import { WEAPON_LABEL } from '../core/bout.js';

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'poule';
const fileBase = (p) => `${slug(p.name)}-${p.date}`;

async function shareOrDownload(file, title) {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return; // user closed the share sheet
  }
  download(file.name, file);
}

export function exportCsv(p) {
  const blob = new Blob([toCsv(p)], { type: 'text/csv;charset=utf-8' });
  download(`${fileBase(p)}.csv`, blob);
  toast('CSV saved');
}

/** Draw the poule sheet onto a canvas (light, print-friendly colours). */
export function drawSheet(p, scale = 2) {
  const n = p.fencers.length;
  const st = stats(p);
  const ranks = new Map(ranking(p).map((r) => [r.id, rankLabel(r)]));
  const pad = 24;
  const rowH = 44;
  const nameW = 190;
  const cellW = 46;
  const resCols = ['V', 'V/M', 'TS', 'TR', 'Ind', 'Rank'];
  const resW = 54;
  const headH = 84;
  const width = pad * 2 + 34 + nameW + n * cellW + resCols.length * resW;
  const height = pad * 2 + headH + rowH * (n + 1) + 30;
  const c = document.createElement('canvas');
  c.width = width * scale;
  c.height = height * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, width, height);
  const font = (size, weight = 400) => `${weight} ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  g.fillStyle = '#111';
  g.font = font(22, 700);
  g.textBaseline = 'middle';
  g.fillText(p.name, pad, pad + 14);
  g.font = font(14);
  g.fillStyle = '#555';
  const prog = progress(p);
  g.fillText(`${p.date} · ${WEAPON_LABEL[p.weapon]} · ${n} fencers · ${prog.done}/${prog.total} bouts`, pad, pad + 42);

  const x0 = pad;
  const y0 = pad + headH;
  const colX = (i) => x0 + 34 + nameW + i * cellW;
  const resX = (i) => colX(n) + i * resW;
  g.strokeStyle = '#999';
  g.lineWidth = 1;
  // Header row
  g.font = font(13, 700);
  g.fillStyle = '#333';
  g.textAlign = 'center';
  for (let i = 0; i < n; i++) g.fillText(String(i + 1), colX(i) + cellW / 2, y0 + rowH / 2);
  resCols.forEach((t, i) => g.fillText(t, resX(i) + resW / 2, y0 + rowH / 2));
  g.textAlign = 'left';
  g.fillText('Fencer', x0 + 34, y0 + rowH / 2);

  p.fencers.forEach((f, r) => {
    const y = y0 + rowH * (r + 1);
    g.textAlign = 'center';
    g.font = font(14, 700);
    g.fillStyle = '#333';
    g.fillText(String(r + 1), x0 + 17, y + rowH / 2);
    g.textAlign = 'left';
    g.font = font(15, 600);
    g.fillStyle = '#111';
    const label = f.club ? `${f.name}` : f.name;
    g.fillText(fit(g, label, nameW - 8), x0 + 34, y + rowH / 2 - (f.club ? 7 : 0));
    if (f.club) {
      g.font = font(11);
      g.fillStyle = '#666';
      g.fillText(fit(g, f.club, nameW - 8), x0 + 34, y + rowH / 2 + 10);
    }
    g.textAlign = 'center';
    p.fencers.forEach((o, ci) => {
      const x = colX(ci);
      if (o.id === f.id) {
        g.fillStyle = '#bbb';
        g.fillRect(x, y, cellW, rowH);
        return;
      }
      const t = cellText(p, f.id, o.id);
      g.font = font(15, t.startsWith('V') ? 800 : 400);
      g.fillStyle = t.startsWith('V') ? '#0a7a2f' : '#b3261e';
      if (t) g.fillText(t, x + cellW / 2, y + rowH / 2);
    });
    const s = st.get(f.id);
    const vals = [s.V, formatVM(s.VM), s.TS, s.TR, s.Ind, ranks.get(f.id)];
    vals.forEach((v, i) => {
      g.font = font(15, i === 5 ? 800 : 500);
      g.fillStyle = '#111';
      g.fillText(String(v), resX(i) + resW / 2, y + rowH / 2);
    });
  });
  // Grid lines
  g.beginPath();
  for (let r = 0; r <= n + 1; r++) {
    g.moveTo(x0, y0 + r * rowH + 0.5);
    g.lineTo(resX(resCols.length), y0 + r * rowH + 0.5);
  }
  const vlines = [
    x0,
    x0 + 34,
    colX(0),
    ...Array.from({ length: n }, (_, i) => colX(i + 1)),
    ...resCols.map((_, i) => resX(i + 1)),
  ];
  for (const x of vlines) {
    g.moveTo(x + 0.5, y0);
    g.lineTo(x + 0.5, y0 + rowH * (n + 1));
  }
  g.stroke();
  g.textAlign = 'left';
  g.font = font(11);
  g.fillStyle = '#888';
  g.fillText('Scored with Piste', pad, height - pad / 2 - 6);
  return c;
}

function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export async function exportImage(p) {
  const canvas = drawSheet(p);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return toast('Could not create image');
  const file = new File([blob], `${fileBase(p)}.png`, { type: 'image/png' });
  await shareOrDownload(file, p.name);
}

/** Printable page: a clean copy of the sheet, standings and bouts. */
export function printPoule(p) {
  const root = document.getElementById('print-root');
  const n = p.fencers.length;
  const st = stats(p);
  const ranks = new Map(ranking(p).map((r) => [r.id, rankLabel(r)]));
  const table = h(
    'table',
    { class: 'print-sheet' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, '#'),
        h('th', { class: 'l' }, 'Fencer'),
        ...p.fencers.map((_, i) => h('th', {}, i + 1)),
        ...['V', 'V/M', 'TS', 'TR', 'Ind', 'Rank'].map((t) => h('th', {}, t)),
      ),
    ),
    h(
      'tbody',
      {},
      ...p.fencers.map((f, r) => {
        const s = st.get(f.id);
        return h(
          'tr',
          {},
          h('th', {}, r + 1),
          h('td', { class: 'l' }, f.name, f.club && h('small', {}, ` ${f.club}`)),
          ...p.fencers.map((o) =>
            o.id === f.id
              ? h('td', { class: 'diag' })
              : h('td', { class: cellText(p, f.id, o.id).startsWith('V') ? 'v' : '' }, cellText(p, f.id, o.id)),
          ),
          h('td', {}, s.V),
          h('td', {}, formatVM(s.VM)),
          h('td', {}, s.TS),
          h('td', {}, s.TR),
          h('td', {}, s.Ind),
          h('td', { class: 'rank' }, ranks.get(f.id)),
        );
      }),
    ),
  );
  const bouts = h(
    'ol',
    { class: 'print-bouts' },
    ...p.bouts.map((b) => {
      const L = fencerById(p, b.leftId)?.name;
      const R = fencerById(p, b.rightId)?.name;
      const score = b.winnerId ? ` ${b.scoreL}–${b.scoreR}` : '';
      return h('li', {}, `${L} v ${R}${score}`);
    }),
  );
  fill(
    root,
    h('h1', {}, p.name),
    h('p', {}, `${p.date} · ${WEAPON_LABEL[p.weapon]} · ${n} fencers`),
    table,
    h('h2', {}, 'Bout order'),
    bouts,
  );
  window.print();
}
