// Direct elimination tableau: seeding from poule results, the FIE bracket
// with byes, results that carry winners forward, and the final ranking.
// Pure functions, unit-tested.
//
// A tableau is kept alongside poules (kind 'tableau') so it can be shared with
// a code in the same way. Only results are stored: who meets whom in later
// rounds is always worked out from the results before it, so a corrected
// result can never leave the bracket inconsistent.

import { uid } from './bout.js';
import { stats, compareStats, validateResult, isDone } from './poule.js';

export { isDone };
export const MIN_FENCERS = 2;
export const MAX_FENCERS = 128;

/** Smallest table that fits n fencers: 2, 4, 8, 16, … */
export function tableSize(n) {
  let s = 2;
  while (s < n) s *= 2;
  return s;
}

/**
 * Seeds in bracket order, top to bottom: 1 and 2 can only meet in the final,
 * 1–4 not before the semi-finals, and so on. Table of 8: 1 8 4 5 2 7 3 6.
 */
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** "Table of 32", "Quarter-finals", "Semi-finals", "Final". */
export function roundName(size) {
  return { 2: 'Final', 4: 'Semi-finals', 8: 'Quarter-finals' }[size] ?? `Table of ${size}`;
}
/** Short label for tabs: "32", "16", "QF", "SF", "Final". */
export function roundShort(size) {
  return { 2: 'Final', 4: 'SF', 8: 'QF' }[size] ?? `T${size}`;
}

// A stored result keeps who fenced (leftId / rightId, upper fencer first), so
// it stops counting if an earlier correction changes who is in the bout.
const blank = () => ({
  leftId: null,
  rightId: null,
  scoreL: null,
  scoreR: null,
  winnerId: null,
  cards: null,
  reason: null,
  history: [],
  finishedAt: null,
});

/** The static bout list for a table: ids 'r16-0' … 'r2-0', biggest round first. */
function boutSlots(size) {
  const out = [];
  for (let r = size; r >= 2; r /= 2)
    for (let i = 0; i < r / 2; i++) out.push({ id: `r${r}-${i}`, round: r, i, ...blank() });
  return out;
}

/**
 * fencers: [{ id, name, club }] in seed order (seed 1 first).
 * target: 15 (senior), 10 or 5.
 */
export function createTableau({
  name,
  date,
  weapon = 'foil',
  target = 15,
  fencers,
  now = Date.now(),
  id,
  source = null,
}) {
  const list = [];
  for (const f of fencers ?? []) {
    if (!f?.id || list.some((x) => x.id === f.id)) continue;
    list.push({ id: f.id, name: String(f.name ?? '').trim() || '?', club: f.club ?? '', seed: list.length + 1 });
  }
  if (list.length < MIN_FENCERS) throw new Error('A tableau needs at least two fencers');
  if (list.length > MAX_FENCERS) throw new Error(`A tableau has at most ${MAX_FENCERS} fencers`);
  const size = tableSize(list.length);
  return {
    kind: 'tableau',
    id: id ?? uid('tab'),
    name: String(name ?? '').trim() || 'Tableau',
    date: date ?? new Date(now).toISOString().slice(0, 10),
    weapon,
    target,
    size,
    fencerIds: list.map((f) => f.id),
    fencers: list,
    bouts: numbered(boutSlots(size), list.length),
    source,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

/** Number the bouts that will actually be fenced (not byes), in round order. */
function numbered(bouts, n) {
  const size = bouts[0].round;
  const order = seedOrder(size);
  let k = 0;
  return bouts.map((b) => {
    const bye = b.round === size && (order[2 * b.i] > n || order[2 * b.i + 1] > n);
    return { ...b, n: bye ? null : ++k };
  });
}

export const fencerById = (t, id) => t.fencers.find((f) => f.id === id);

/**
 * The whole bracket, worked out from the stored results.
 * Returns [{ size, name, bouts: [{ ...bout, leftId, rightId, bye, ready, done, winnerId, loserId }] }]
 * biggest round first. `leftId` is the fencer from the upper half of the bout.
 */
export function bracket(t) {
  const order = seedOrder(t.size);
  const bySeed = (s) => t.fencers[s - 1]?.id ?? null;
  const stored = new Map(t.bouts.map((b) => [b.id, b]));
  const rounds = [];
  let prev = null;
  for (let r = t.size; r >= 2; r /= 2) {
    const bouts = [];
    for (let i = 0; i < r / 2; i++) {
      const b = stored.get(`r${r}-${i}`);
      let leftId;
      let rightId;
      let bye = false;
      if (!prev) {
        leftId = bySeed(order[2 * i]);
        rightId = bySeed(order[2 * i + 1]);
        bye = !leftId || !rightId;
      } else {
        leftId = prev[2 * i].winnerId;
        rightId = prev[2 * i + 1].winnerId;
      }
      let winnerId = null;
      if (bye) winnerId = leftId ?? rightId;
      else if (
        leftId &&
        rightId &&
        (b.winnerId === leftId || b.winnerId === rightId) &&
        (!b.leftId || (b.leftId === leftId && b.rightId === rightId))
      )
        winnerId = b.winnerId;
      const done = !bye && winnerId != null;
      bouts.push({
        ...b,
        leftId,
        rightId,
        bye,
        ready: !bye && Boolean(leftId && rightId) && !done,
        done,
        winnerId,
        loserId: done ? (winnerId === leftId ? rightId : leftId) : null,
      });
    }
    rounds.push({ size: r, name: roundName(r), short: roundShort(r), bouts });
    prev = bouts;
  }
  return rounds;
}

/** A single bout of the bracket by id (with its fencers worked out), or null. */
export function boutOf(t, boutId) {
  for (const r of bracket(t)) {
    const b = r.bouts.find((x) => x.id === boutId);
    if (b) return { ...b, roundName: r.name };
  }
  return null;
}

/** Bouts that can be fenced now (both fencers known, no result), in order. */
export function pendingBouts(t) {
  return bracket(t)
    .flatMap((r) => r.bouts.map((b) => ({ ...b, roundName: r.name })))
    .filter((b) => b.ready);
}

export function nextBout(t) {
  return pendingBouts(t)[0] ?? null;
}

/** Bouts fenced / to fence (byes don't count): n fencers → n − 1 bouts. */
export function progress(t) {
  const all = bracket(t).flatMap((r) => r.bouts);
  return { done: all.filter((b) => b.done).length, total: t.fencers.length - 1 };
}

/** Clear stored results that no longer fit the bracket (after an earlier result changed). */
function settle(t, now) {
  for (;;) {
    const valid = new Map(bracket(t).flatMap((r) => r.bouts.map((b) => [b.id, b])));
    const stale = t.bouts.filter((b) => b.winnerId != null && valid.get(b.id).winnerId !== b.winnerId);
    if (!stale.length) break;
    const ids = new Set(stale.map((b) => b.id));
    t = { ...t, bouts: t.bouts.map((b) => (ids.has(b.id) ? { ...b, ...blank() } : b)) };
  }
  const final = t.bouts.find((b) => b.round === 2);
  return { ...t, status: final.winnerId ? 'finished' : 'active', updatedAt: now };
}

/**
 * Record a result. `result` is in its own leftId/rightId orientation (e.g. from
 * the scorer after a side swap) and is turned to the bracket's orientation.
 * Without leftId it is taken as already in bracket orientation (server data).
 */
export function recordResult(t, boutId, result, now = Date.now()) {
  const b = boutOf(t, boutId);
  if (!b) throw new Error('Unknown bout');
  if (b.bye || !b.leftId || !b.rightId) throw new Error('This bout isn’t ready yet');
  let { scoreL, scoreR } = result;
  let cards = result.cards ?? null;
  if (result.leftId && result.rightId) {
    const same = new Set([result.leftId, result.rightId]);
    if (!same.has(b.leftId) || !same.has(b.rightId)) throw new Error('This result is for a different pair of fencers');
  }
  if (result.leftId && result.leftId === b.rightId) {
    [scoreL, scoreR] = [scoreR, scoreL];
    if (cards) cards = { left: cards.right, right: cards.left };
  }
  const v = validateResult(b, { scoreL, scoreR, winnerId: result.winnerId });
  if (!v.ok) throw new Error(v.error);
  const updated = {
    leftId: b.leftId,
    rightId: b.rightId,
    scoreL,
    scoreR,
    winnerId: v.winnerId,
    cards,
    reason: result.reason ?? null,
    history: result.history ?? [],
    finishedAt: result.finishedAt ?? now,
  };
  return settle({ ...t, bouts: t.bouts.map((x) => (x.id === boutId ? { ...x, ...updated } : x)) }, now);
}

/** Clear a result; later results that depended on it are cleared too. */
export function clearResult(t, boutId, now = Date.now()) {
  return settle({ ...t, bouts: t.bouts.map((x) => (x.id === boutId ? { ...x, ...blank() } : x)) }, now);
}

/**
 * Final ranking (FIE): winner 1st, finalist 2nd, both losing semi-finalists
 * 3rd equal; fencers knocked out in the same earlier round are placed by seed.
 * Fencers still in are listed with place null.
 * Returns [{ fencer, place, tied, out: round size | null }] in order.
 */
export function finalRanking(t) {
  const rounds = bracket(t);
  const seed = (id) => fencerById(t, id).seed;
  const out = [];
  const final = rounds.at(-1).bouts[0];
  const placed = new Set();
  if (final.done) {
    out.push({ fencer: fencerById(t, final.winnerId), place: 1, tied: false, out: null });
    placed.add(final.winnerId);
  }
  for (const r of [...rounds].reverse()) {
    const losers = r.bouts
      .filter((b) => b.done)
      .map((b) => b.loserId)
      .sort((a, b) => seed(a) - seed(b));
    if (!losers.length) continue;
    const first = r.size / 2 + 1;
    losers.forEach((id, i) => {
      placed.add(id);
      out.push({
        fencer: fencerById(t, id),
        place: r.size === 4 ? 3 : first + i,
        tied: r.size === 4 && losers.length > 1,
        out: r.size,
      });
    });
  }
  const still = t.fencers.filter((f) => !placed.has(f.id));
  return [...still.map((f) => ({ fencer: f, place: null, tied: false, out: null })), ...out].sort(
    (a, b) => (a.place ?? 0) - (b.place ?? 0) || a.fencer.seed - b.fencer.seed,
  );
}

export const placeLabel = (r) => (r.place == null ? '–' : `${r.place}${r.tied ? '=' : ''}`);

/**
 * Seeding from one or more poules: everyone ranked together by V/M, then
 * indicator, then touches scored (the FIE ranking after the poule round).
 * Returns [{ fencer, V, M, VM, TS, TR, Ind, poule, rank, tied }] in seed order.
 */
export function seedFromPoules(poules) {
  const rows = [];
  const seen = new Set();
  poules.forEach((p, pi) => {
    const st = stats(p);
    for (const f of p.fencers) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      rows.push({ ...st.get(f.id), fencer: { id: f.id, name: f.name, club: f.club ?? '' }, poule: p.name, pi });
    }
  });
  rows.sort((a, b) => compareStats(a, b) || a.pi - b.pi || a.fencer.name.localeCompare(b.fencer.name));
  let rank = 0;
  rows.forEach((r, i) => {
    if (i === 0 || compareStats(rows[i - 1], r) !== 0) rank = i + 1;
    r.rank = rank;
  });
  for (const r of rows) r.tied = rows.filter((x) => x.rank === r.rank).length > 1;
  return rows;
}

/* ---------- sharing ---------- */

/** What other phones need to rebuild the tableau. */
export function metaOf(t) {
  return {
    v: 1,
    kind: 'tableau',
    id: t.id,
    name: t.name,
    date: t.date,
    weapon: t.weapon,
    target: t.target,
    size: t.size,
    fencers: t.fencers.map((f) => ({ id: f.id, name: f.name, club: f.club ?? '', seed: f.seed })),
    bouts: t.bouts.map((b) => ({ id: b.id, round: b.round, i: b.i, n: b.n })),
    createdAt: t.createdAt,
  };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Rebuild a tableau from shared meta (no results yet). Throws if unusable. */
export function fromMeta(m, now = Date.now()) {
  const fencers = (Array.isArray(m.fencers) ? m.fencers : Object.values(m.fencers ?? {}))
    .filter((f) => f && typeof f.id === 'string')
    .sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
    .map((f) => ({ id: f.id, name: str(f.name, 40) || '?', club: str(f.club, 40) }));
  const t = createTableau({
    id: str(m.id, 80) || undefined,
    name: str(m.name, 60) || 'Shared tableau',
    date: /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? m.date : undefined,
    weapon: ['foil', 'epee', 'sabre'].includes(m.weapon) ? m.weapon : 'foil',
    target: Number.isInteger(m.target) && m.target > 0 && m.target <= 45 ? m.target : 15,
    fencers,
    now,
  });
  if (m.size !== t.size) throw new Error('This shared tableau is damaged');
  return { ...t, createdAt: Number(m.createdAt) || now };
}

/* ---------- export ---------- */

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells) => cells.map(csvCell).join(',');

export function toCsv(t) {
  const name = (id) => (id ? fencerById(t, id)?.name : '');
  const seed = (id) => (id ? fencerById(t, id)?.seed : '');
  const rows = [
    line(['Tableau', t.name]),
    line(['Date', t.date]),
    line(['Weapon', t.weapon]),
    line(['Bouts to', t.target]),
    '',
  ];
  rows.push(line(['Place', 'Name', 'Club', 'Seed']));
  for (const r of finalRanking(t)) rows.push(line([placeLabel(r), r.fencer.name, r.fencer.club, r.fencer.seed]));
  rows.push('', line(['Round', 'Bout', 'Seed', 'Fencer', 'Score', 'Score', 'Fencer', 'Seed', 'Winner']));
  for (const r of bracket(t)) {
    for (const b of r.bouts) {
      if (b.bye) {
        const id = b.leftId ?? b.rightId;
        rows.push(line([r.name, '', seed(id), name(id), 'bye', '', '', '', name(id)]));
        continue;
      }
      rows.push(
        line([
          r.name,
          b.n ?? '',
          seed(b.leftId),
          name(b.leftId),
          b.done ? b.scoreL : '',
          b.done ? b.scoreR : '',
          name(b.rightId),
          seed(b.rightId),
          name(b.winnerId),
        ]),
      );
    }
  }
  return rows.join('\r\n') + '\r\n';
}
