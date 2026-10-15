// A clean results report, rendered two ways from one description:
// a PNG (for sharing in chats) and an HTML page (for printing / PDF).
//
// report = {
//   title, subtitle,
//   hero?: { left: { label, value }, right: { label, value }, note },
//   sections: [{ title, columns: [{ label, align?, min? }], rows: [[cell, …]], printOnly? }],
// }
// cell = string | number | { text, tone?: 'win' | 'loss' | 'muted' | 'red' | 'green', bold?, fill?: 'diag' | 'gold' }

import { h, fill, download, toast } from './dom.js';

const C = {
  bg: '#ffffff',
  text: '#000000',
  muted: '#6e6e73',
  sep: '#e5e5ea',
  head: '#f2f2f7',
  diag: '#d1d1d6',
  gold: '#ffcc00',
  win: '#248a3d',
  loss: '#d70015',
  red: '#d70015',
  green: '#248a3d',
};
const SANS = '-apple-system, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const ROUNDED = 'ui-rounded, "SF Pro Rounded", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const font = (size, weight = 400, family = SANS) => `${weight} ${size}px ${family}`;

const norm = (c) => (c != null && typeof c === 'object' ? c : { text: c ?? '' });

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'results';

/* ---------- PNG ---------- */

export function drawReport(r, scale = 2) {
  const PAD = 32;
  const ROW = 42;
  const HEAD = 34;
  const measure = document.createElement('canvas').getContext('2d');
  // Column widths from content.
  const layouts = r.sections
    .filter((s) => !s.printOnly)
    .map((s) => {
      const widths = s.columns.map((col, i) => {
        measure.font = font(13, 600);
        let w = measure.measureText(col.label).width;
        measure.font = font(16, 600);
        for (const row of s.rows) w = Math.max(w, measure.measureText(String(norm(row[i]).text)).width);
        return Math.max(col.min ?? 34, Math.min(220, Math.ceil(w) + 24));
      });
      return { s, widths, width: widths.reduce((a, b) => a + b, 0) };
    });
  const width = Math.max(560, ...layouts.map((l) => l.width)) + PAD * 2;
  let height = PAD + 40 + 28 + 20;
  if (r.hero) height += 128;
  for (const l of layouts) height += 34 + HEAD + l.s.rows.length * ROW + 28;
  height += 24;

  const c = document.createElement('canvas');
  c.width = width * scale;
  c.height = height * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = C.bg;
  g.fillRect(0, 0, width, height);
  g.textBaseline = 'middle';

  let y = PAD + 18;
  g.fillStyle = C.text;
  g.font = font(30, 700);
  g.fillText(fit(g, r.title, width - PAD * 2), PAD, y);
  y += 32;
  g.fillStyle = C.muted;
  g.font = font(16);
  g.fillText(fit(g, r.subtitle ?? '', width - PAD * 2), PAD, y);
  y += 30;

  if (r.hero) {
    const w = (width - PAD * 2 - 12) / 2;
    [
      [r.hero.left, C.red, PAD],
      [r.hero.right, C.green, PAD + w + 12],
    ].forEach(([side, color, x]) => {
      roundRect(g, x, y, w, 104, 18);
      g.fillStyle = C.head;
      g.fill();
      g.fillStyle = color;
      g.font = font(17, 700);
      g.textAlign = 'center';
      g.fillText(fit(g, side.label, w - 24), x + w / 2, y + 26);
      g.fillStyle = C.text;
      g.font = font(52, 700, ROUNDED);
      g.fillText(String(side.value), x + w / 2, y + 70);
      g.textAlign = 'left';
    });
    y += 116;
    if (r.hero.note) {
      g.fillStyle = C.text;
      g.font = font(17, 600);
      g.textAlign = 'center';
      g.fillText(r.hero.note, width / 2, y + 2);
      g.textAlign = 'left';
      y += 12;
    }
  }

  for (const { s, widths } of layouts) {
    y += 22;
    g.fillStyle = C.muted;
    g.font = font(13, 600);
    g.fillText(s.title.toUpperCase(), PAD + 2, y);
    y += 14;
    const tableW = widths.reduce((a, b) => a + b, 0);
    const tableH = HEAD + s.rows.length * ROW;
    g.save();
    roundRect(g, PAD, y, tableW, tableH, 12);
    g.clip();
    g.fillStyle = C.head;
    g.fillRect(PAD, y, tableW, HEAD);
    let x = PAD;
    s.columns.forEach((col, i) => {
      g.fillStyle = C.muted;
      g.font = font(13, 600);
      text(g, col.label, x, widths[i], y + HEAD / 2, col.align);
      x += widths[i];
    });
    s.rows.forEach((row, ri) => {
      const ry = y + HEAD + ri * ROW;
      x = PAD;
      row.forEach((raw, ci) => {
        const cell = norm(raw);
        if (cell.fill) {
          g.fillStyle = cell.fill === 'gold' ? C.gold : C.diag;
          g.fillRect(x, ry, widths[ci], ROW);
        }
        g.fillStyle = cell.tone ? C[cell.tone] : C.text;
        const numeric = /^[-+]?[\d.:–\s]+$|^[VD]\d+$/.test(String(cell.text));
        g.font = font(16, cell.bold ? 700 : 500, numeric ? ROUNDED : SANS);
        text(g, String(cell.text), x, widths[ci], ry + ROW / 2, s.columns[ci].align);
        x += widths[ci];
      });
      g.strokeStyle = C.sep;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(PAD, ry + 0.5);
      g.lineTo(PAD + tableW, ry + 0.5);
      g.stroke();
    });
    g.restore();
    g.strokeStyle = C.sep;
    roundRect(g, PAD + 0.5, y + 0.5, tableW - 1, tableH - 1, 12);
    g.stroke();
    y += tableH + 6;
  }
  g.fillStyle = C.muted;
  g.font = font(12);
  g.fillText('Scored with Piste', PAD, height - 22);
  return c;
}

function text(g, s, x, w, y, align = 'center') {
  const t = fit(g, s, w - 16);
  if (align === 'left') {
    g.textAlign = 'left';
    g.fillText(t, x + 12, y);
  } else if (align === 'right') {
    g.textAlign = 'right';
    g.fillText(t, x + w - 12, y);
  } else {
    g.textAlign = 'center';
    g.fillText(t, x + w / 2, y);
  }
  g.textAlign = 'left';
}

function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ---------- HTML (print) ---------- */

export function printReport(r) {
  const root = document.getElementById('print-root');
  const cls = (c) => [c.tone && `t-${c.tone}`, c.bold && 'b', c.fill && `f-${c.fill}`].filter(Boolean).join(' ');
  fill(
    root,
    h('h1', {}, r.title),
    h('p', { class: 'sub' }, r.subtitle ?? ''),
    r.hero &&
      h(
        'div',
        { class: 'hero' },
        h('div', { class: 'red' }, h('span', {}, r.hero.left.label), h('b', {}, r.hero.left.value)),
        h('div', { class: 'green' }, h('span', {}, r.hero.right.label), h('b', {}, r.hero.right.value)),
      ),
    r.hero?.note && h('p', { class: 'note' }, r.hero.note),
    ...r.sections.map((s) =>
      h(
        'section',
        {},
        h('h2', {}, s.title),
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, ...s.columns.map((c) => h('th', { class: c.align ?? '' }, c.label)))),
          h(
            'tbody',
            {},
            ...s.rows.map((row) =>
              h(
                'tr',
                {},
                ...row.map((raw, i) => {
                  const c = norm(raw);
                  return h('td', { class: `${s.columns[i].align ?? ''} ${cls(c)}` }, String(c.text));
                }),
              ),
            ),
          ),
        ),
      ),
    ),
    h('p', { class: 'foot' }, 'Scored with Piste'),
  );
  window.print();
}

/* ---------- files ---------- */

export async function shareOrDownload(file, title) {
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

export async function shareReportImage(r, filename) {
  const canvas = drawReport(r);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return toast('Could not create image');
  await shareOrDownload(new File([blob], filename, { type: 'image/png' }), r.title);
}

export function downloadCsv(csv, filename) {
  // BOM so Excel opens accented names (Épée, Laurent…) correctly.
  download(filename, new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  toast('CSV saved');
}
