// Poule logic: bout order, results, indicators and ranking. Pure functions.

import { uid } from './bout.js';

// Standard FIE pool bout-order tables (also used by USA Fencing). Numbers are
// the fencers' positions on the poule sheet. For 5 or more fencers nobody
// fences two bouts in a row; for 3 and 4 that is mathematically unavoidable.
export const BOUT_ORDERS = {
  3: [
    [1, 2],
    [2, 3],
    [1, 3],
  ],
  4: [
    [1, 4],
    [2, 3],
    [1, 3],
    [2, 4],
    [3, 4],
    [1, 2],
  ],
  5: [
    [1, 2],
    [3, 4],
    [5, 1],
    [2, 3],
    [5, 4],
    [1, 3],
    [2, 5],
    [4, 1],
    [3, 5],
    [4, 2],
  ],
  6: [
    [1, 2],
    [4, 5],
    [2, 3],
    [5, 6],
    [3, 1],
    [6, 4],
    [2, 5],
    [1, 4],
    [5, 3],
    [1, 6],
    [4, 2],
    [3, 6],
    [5, 1],
    [3, 4],
    [6, 2],
  ],
  7: [
    [1, 4],
    [2, 5],
    [3, 6],
    [7, 1],
    [5, 4],
    [2, 3],
    [6, 7],
    [5, 1],
    [4, 3],
    [6, 2],
    [5, 7],
    [3, 1],
    [4, 6],
    [7, 2],
    [3, 5],
    [1, 6],
    [2, 4],
    [7, 3],
    [6, 5],
    [1, 2],
    [4, 7],
  ],
  8: [
    [2, 3],
    [1, 5],
    [7, 4],
    [6, 8],
    [1, 2],
    [3, 4],
    [5, 6],
    [8, 7],
    [4, 1],
    [5, 2],
    [8, 3],
    [6, 7],
    [4, 2],
    [8, 1],
    [7, 5],
    [3, 6],
    [2, 8],
    [5, 4],
    [6, 1],
    [3, 7],
    [4, 8],
    [2, 6],
    [3, 5],
    [1, 7],
    [4, 6],
    [8, 5],
    [7, 2],
    [1, 3],
  ],
};

export const MIN_FENCERS = 3;
export const MAX_FENCERS = 8;

export function boutOrder(n) {
  const order = BOUT_ORDERS[n];
  if (!order) throw new Error(`Poules must have ${MIN_FENCERS}–${MAX_FENCERS} fencers`);
  return order.map(([a, b]) => [a, b]);
}

/** fencers: [{id, name, club}] in sheet order (position 1 first). */
export function createPoule({ name, date, weapon = 'foil', target = 5, fencers, now = Date.now(), id }) {
  const order = boutOrder(fencers.length);
  const list = fencers.map((f) => ({ id: f.id, name: f.name, club: f.club ?? '' }));
  return {
    id: id ?? uid('poule'),
    name: name?.trim() || 'Poule',
    date: date ?? new Date(now).toISOString().slice(0, 10),
    weapon,
    target,
    fencerIds: list.map((f) => f.id),
    fencers: list,
    bouts: order.map(([a, b], i) => ({
      id: uid('pb'),
      n: i + 1,
      leftId: list[a - 1].id,
      rightId: list[b - 1].id,
      scoreL: null,
      scoreR: null,
      winnerId: null,
      cards: null,
      history: [],
      finishedAt: null,
    })),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicatePoule(p, now = Date.now()) {
  return createPoule({
    name: `${p.name} (copy)`,
    date: new Date(now).toISOString().slice(0, 10),
    weapon: p.weapon,
    target: p.target,
    fencers: p.fencers,
    now,
  });
}

export const isDone = (b) => b.winnerId != null;

export function fencerById(p, id) {
  return p.fencers.find((f) => f.id === id);
}

export function nextBout(p) {
  return p.bouts.find((b) => !isDone(b)) ?? null;
}

export function progress(p) {
  const done = p.bouts.filter(isDone).length;
  return { done, total: p.bouts.length };
}

/** Find the bout between two fencers (in either orientation). */
export function findBout(p, idA, idB) {
  return p.bouts.find((b) => (b.leftId === idA && b.rightId === idB) || (b.leftId === idB && b.rightId === idA));
}

/**
 * Validate a result. `winnerId` is required when scores are level (a bout won
 * on priority, or by black card); otherwise it defaults to the higher score.
 * Returns { ok, winnerId, error }.
 */
export function validateResult(b, { scoreL, scoreR, winnerId }) {
  if (![scoreL, scoreR].every((x) => Number.isInteger(x) && x >= 0 && x <= 99)) {
    return { ok: false, error: 'Scores must be whole numbers' };
  }
  let w = winnerId ?? null;
  if (w == null) {
    if (scoreL === scoreR) return { ok: false, error: 'Level score: choose who won on priority' };
    w = scoreL > scoreR ? b.leftId : b.rightId;
  }
  if (w !== b.leftId && w !== b.rightId) return { ok: false, error: 'Winner is not in this bout' };
  return { ok: true, winnerId: w };
}

/**
 * Write a result into a poule. `result` uses the orientation given by its own
 * leftId/rightId (e.g. after the scorer swapped sides); it is normalised to the
 * poule bout's orientation.
 */
export function recordResult(p, boutId, result, now = Date.now()) {
  const b = p.bouts.find((x) => x.id === boutId);
  if (!b) throw new Error('Unknown bout');
  let { scoreL, scoreR } = result;
  let cards = result.cards ?? null;
  if (result.leftId && result.leftId === b.rightId) {
    [scoreL, scoreR] = [scoreR, scoreL];
    if (cards) cards = { left: cards.right, right: cards.left };
  }
  const v = validateResult(b, { scoreL, scoreR, winnerId: result.winnerId });
  if (!v.ok) throw new Error(v.error);
  const updated = {
    ...b,
    scoreL,
    scoreR,
    winnerId: v.winnerId,
    cards,
    reason: result.reason ?? null,
    history: result.history ?? [],
    finishedAt: result.finishedAt ?? now,
  };
  return withStatus({ ...p, bouts: p.bouts.map((x) => (x.id === boutId ? updated : x)), updatedAt: now });
}

export function clearResult(p, boutId, now = Date.now()) {
  const bouts = p.bouts.map((b) =>
    b.id === boutId
      ? { ...b, scoreL: null, scoreR: null, winnerId: null, cards: null, reason: null, history: [], finishedAt: null }
      : b,
  );
  return withStatus({ ...p, bouts, updatedAt: now });
}

function withStatus(p) {
  return { ...p, status: p.bouts.every(isDone) ? 'finished' : 'active' };
}

/** Result of a bout from `fencerId`'s point of view, or null if not fenced. */
export function resultFor(b, fencerId) {
  if (!isDone(b)) return null;
  const mine = b.leftId === fencerId ? b.scoreL : b.scoreR;
  const theirs = b.leftId === fencerId ? b.scoreR : b.scoreL;
  return { victory: b.winnerId === fencerId, scored: mine, received: theirs };
}

/** Sheet cell text: "V5" / "D3" from the row fencer's point of view. */
export function cellText(p, rowId, colId) {
  if (rowId === colId) return null;
  const b = findBout(p, rowId, colId);
  const r = b && resultFor(b, rowId);
  if (!r) return '';
  return `${r.victory ? 'V' : 'D'}${r.scored}`;
}

/** Indicators per fencer: V, M, VM, TS, TR, Ind. */
export function stats(p) {
  const out = new Map();
  for (const f of p.fencers) out.set(f.id, { id: f.id, V: 0, M: 0, VM: 0, TS: 0, TR: 0, Ind: 0 });
  for (const b of p.bouts) {
    if (!isDone(b)) continue;
    for (const id of [b.leftId, b.rightId]) {
      const s = out.get(id);
      if (!s) continue;
      const r = resultFor(b, id);
      s.M += 1;
      s.V += r.victory ? 1 : 0;
      s.TS += r.scored;
      s.TR += r.received;
    }
  }
  for (const s of out.values()) {
    s.VM = s.M ? s.V / s.M : 0;
    s.Ind = s.TS - s.TR;
  }
  return out;
}

/** Compare two stat rows: negative if a ranks above b. V/M, then Ind, then TS. */
export function compareStats(a, b) {
  // Cross-multiply V/M to avoid floating-point ties being split.
  const vm = b.V * a.M - a.V * b.M;
  if (a.M && b.M && vm !== 0) return vm;
  if (!a.M || !b.M) {
    const d = b.VM - a.VM;
    if (d !== 0) return d;
  }
  if (b.Ind !== a.Ind) return b.Ind - a.Ind;
  return b.TS - a.TS;
}

/**
 * Ranking with ties: tied fencers share a rank ("2=") and the next rank skips
 * (1, 2=, 2=, 4). Returns [{ ...stats, fencer, rank, tied }] in rank order.
 */
export function ranking(p) {
  const st = stats(p);
  const rows = p.fencers.map((f, i) => ({ ...st.get(f.id), fencer: f, pos: i + 1 }));
  rows.sort((a, b) => compareStats(a, b) || a.pos - b.pos);
  let rank = 0;
  rows.forEach((r, i) => {
    if (i === 0 || compareStats(rows[i - 1], r) !== 0) rank = i + 1;
    r.rank = rank;
  });
  for (const r of rows) r.tied = rows.filter((x) => x.rank === r.rank).length > 1;
  return rows;
}

export function rankLabel(r) {
  return `${r.rank}${r.tied ? '=' : ''}`;
}

export function formatVM(vm) {
  return vm.toFixed(3).replace(/^0/, '');
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(p) {
  const st = stats(p);
  const ranks = new Map(ranking(p).map((r) => [r.id, rankLabel(r)]));
  const n = p.fencers.length;
  const lines = [];
  lines.push([p.name, p.date, p.weapon].map(csvCell).join(','));
  lines.push(
    ['#', 'Name', 'Club', ...Array.from({ length: n }, (_, i) => i + 1), 'V', 'V/M', 'TS', 'TR', 'Ind', 'Rank'].join(
      ',',
    ),
  );
  p.fencers.forEach((f, i) => {
    const s = st.get(f.id);
    const cells = p.fencers.map((g) => (g.id === f.id ? 'X' : cellText(p, f.id, g.id)));
    lines.push(
      [i + 1, f.name, f.club, ...cells, s.V, formatVM(s.VM), s.TS, s.TR, s.Ind, ranks.get(f.id)].map(csvCell).join(','),
    );
  });
  lines.push('');
  lines.push('Bout,Left,Right,Score L,Score R,Winner');
  for (const b of p.bouts) {
    lines.push(
      [
        b.n,
        fencerById(p, b.leftId)?.name,
        fencerById(p, b.rightId)?.name,
        b.scoreL ?? '',
        b.scoreR ?? '',
        b.winnerId ? fencerById(p, b.winnerId)?.name : '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
