import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tableSize,
  seedOrder,
  roundName,
  createTableau,
  bracket,
  boutOf,
  pendingBouts,
  nextBout,
  progress,
  recordResult,
  clearResult,
  finalRanking,
  placeLabel,
  seedFromPoules,
  toCsv,
} from '../app/js/core/tableau.js';
import { createPoule, recordResult as pouleResult, findBout } from '../app/js/core/poule.js';
import { metaOf, resultsOf, pouleFromShare, applyRemote, changedBouts } from '../app/js/core/share.js';

const fencers = (n) => Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, name: `F${i + 1}` }));
const tab = (n, opts = {}) => createTableau({ name: 'DE', fencers: fencers(n), now: 0, ...opts });
/** The upper (lower-numbered seed) fencer wins every ready bout until `rounds` rounds are done, or all. */
function fenceAll(t, pick = (b) => b.leftId) {
  for (let b = nextBout(t); b; b = nextBout(t)) {
    const w = pick(b);
    t = recordResult(t, b.id, {
      scoreL: w === b.leftId ? 15 : 9,
      scoreR: w === b.leftId ? 9 : 15,
      winnerId: w,
    });
  }
  return t;
}
const seedOf = (t, id) => t.fencers.find((f) => f.id === id).seed;
const better = (t) => (b) => (seedOf(t, b.leftId) < seedOf(t, b.rightId) ? b.leftId : b.rightId);

test('table size is the next power of two', () => {
  assert.deepEqual([2, 3, 4, 5, 8, 9, 16, 17, 33].map(tableSize), [2, 4, 4, 8, 8, 16, 16, 32, 64]);
});

test('seed order: FIE pairings, top seeds kept apart', () => {
  assert.deepEqual(seedOrder(2), [1, 2]);
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  const o16 = seedOrder(16);
  // first-round pairs add up to 17; 1 and 2 in opposite halves; 1–4 in different quarters
  for (let i = 0; i < 16; i += 2) assert.equal(o16[i] + o16[i + 1], 17);
  assert.ok(o16.slice(0, 8).includes(1) && o16.slice(8).includes(2));
  const quarter = (s) => Math.floor(o16.indexOf(s) / 4);
  assert.equal(new Set([1, 2, 3, 4].map(quarter)).size, 4);
  assert.equal(roundName(16), 'Table of 16');
  assert.deepEqual([8, 4, 2].map(roundName), ['Quarter-finals', 'Semi-finals', 'Final']);
});

test('byes: 12 fencers in a table of 16, seeds 1–4 go straight through', () => {
  const t = tab(12);
  assert.equal(t.size, 16);
  const [first, second] = bracket(t);
  const byes = first.bouts.filter((b) => b.bye);
  assert.equal(byes.length, 4);
  assert.deepEqual(byes.map((b) => seedOf(t, b.winnerId)).sort(), [1, 2, 3, 4]);
  // seed 1 is already in the quarter-final, waiting for the winner of 8 v 9
  assert.equal(second.bouts[0].leftId, 'f1');
  assert.equal(second.bouts[0].rightId, null);
  assert.equal(pendingBouts(t).length, 4, 'four real first-round bouts');
  assert.equal(progress(t).total, 11, 'n − 1 bouts');
  // fenced bouts are numbered 1, 2, 3 … in order; byes have no number
  assert.deepEqual(
    pendingBouts(t).map((b) => b.n),
    [1, 2, 3, 4],
  );
});

test('winners move on; the final decides the tableau', () => {
  let t = tab(8);
  t = fenceAll(t, better(t));
  assert.equal(t.status, 'finished');
  assert.equal(progress(t).done, 7);
  const r = finalRanking(t);
  assert.deepEqual(
    r.map((x) => `${placeLabel(x)}:${x.fencer.seed}`),
    ['1:1', '2:2', '3=:3', '3=:4', '5:5', '6:6', '7:7', '8:8'],
  );
});

test('upsets: places in a round go by seed, not by who beat whom', () => {
  let t = tab(8);
  // the lower seed wins every bout
  t = fenceAll(t, (b) => (seedOf(t, b.leftId) > seedOf(t, b.rightId) ? b.leftId : b.rightId));
  const r = finalRanking(t);
  assert.equal(r[0].fencer.seed, 8, 'seed 8 won');
  // quarter-final losers were 1, 2, 3, 4: placed 5–8 in seed order
  assert.deepEqual(
    r.slice(4).map((x) => `${x.place}:${x.fencer.seed}`),
    ['5:1', '6:2', '7:3', '8:4'],
  );
});

test('scores from the scorer are turned to bracket order', () => {
  let t = tab(4);
  const b = nextBout(t); // 1 v 4
  t = recordResult(t, b.id, { leftId: b.rightId, rightId: b.leftId, scoreL: 15, scoreR: 11 });
  const done = boutOf(t, b.id);
  assert.equal(done.winnerId, b.rightId);
  assert.deepEqual([done.scoreL, done.scoreR], [11, 15]);
});

test('a level score needs a winner (priority); the loser can’t be named winner of a later bout', () => {
  let t = tab(4);
  const b = nextBout(t);
  assert.throws(() => recordResult(t, b.id, { scoreL: 10, scoreR: 10 }), /priority/);
  t = recordResult(t, b.id, { scoreL: 10, scoreR: 10, winnerId: b.rightId });
  assert.equal(boutOf(t, b.id).winnerId, b.rightId);
  const final = boutOf(t, 'r2-0');
  assert.throws(
    () => recordResult(t, final.id, { scoreL: 15, scoreR: 3, winnerId: 'f1' }),
    /isn’t ready|not in this bout/,
  );
});

test('changing an early result clears the later results that depended on it', () => {
  let t = tab(4);
  t = fenceAll(t, better(t)); // 1 beats 4, 2 beats 3, 1 beats 2
  assert.equal(t.status, 'finished');
  const sf = boutOf(t, 'r4-0'); // 1 v 4
  t = recordResult(t, sf.id, { scoreL: 12, scoreR: 15 }); // now 4 wins
  assert.equal(boutOf(t, 'r2-0').winnerId, null, 'final cleared');
  assert.equal(t.bouts.find((b) => b.id === 'r2-0').winnerId, null, 'stored result cleared too');
  assert.equal(t.status, 'active');
  assert.equal(boutOf(t, 'r2-0').leftId, 'f4');
  // the other semi-final is untouched
  assert.equal(boutOf(t, 'r4-1').winnerId, 'f2');
  t = clearResult(t, 'r4-1');
  assert.equal(boutOf(t, 'r2-0').rightId, null);
});

test('two fencers: just a final', () => {
  let t = tab(2);
  assert.equal(bracket(t).length, 1);
  t = fenceAll(t);
  assert.deepEqual(
    finalRanking(t).map((r) => r.place),
    [1, 2],
  );
});

test('a tableau needs 2+ fencers and drops duplicates', () => {
  assert.throws(() => tab(1), /two fencers/);
  const t = createTableau({ fencers: [...fencers(3), { id: 'f1', name: 'again' }] });
  assert.equal(t.fencers.length, 3);
  assert.deepEqual(
    t.fencers.map((f) => f.seed),
    [1, 2, 3],
  );
});

test('seeding from several poules ranks everyone together', () => {
  const mk = (name, ids) => createPoule({ name, fencers: ids.map((id) => ({ id, name: id.toUpperCase() })), now: 0 });
  let a = mk('A', ['a1', 'a2', 'a3']);
  let b = mk('B', ['b1', 'b2', 'b3']);
  const win = (p, x, y, sx, sy) =>
    pouleResult(p, findBout(p, x, y).id, { leftId: x, rightId: y, scoreL: sx, scoreR: sy });
  a = win(a, 'a1', 'a2', 5, 0);
  a = win(a, 'a1', 'a3', 5, 0);
  a = win(a, 'a2', 'a3', 5, 4);
  b = win(b, 'b1', 'b2', 5, 4);
  b = win(b, 'b1', 'b3', 5, 4);
  b = win(b, 'b2', 'b3', 5, 3);
  const s = seedFromPoules([a, b]);
  assert.deepEqual(
    s.map((r) => r.fencer.id),
    ['a1', 'b1', 'b2', 'a2', 'b3', 'a3'],
  );
  assert.equal(s[0].poule, 'A');
  assert.deepEqual(
    s.map((r) => r.rank),
    [1, 2, 3, 4, 5, 6],
  );
});

test('CSV lists the ranking and every bout', () => {
  let t = tab(3);
  t = fenceAll(t, better(t));
  const csv = toCsv(t);
  assert.match(csv, /^Tableau,DE\r\n/);
  assert.match(csv, /1,F1,,1/);
  assert.match(csv, /Semi-finals,,1,F1,bye/);
  assert.match(csv, /Final,2,1,F1,15,9,F2,2,F1/);
});

test('sharing: meta rebuilds the same tableau, results stream in round order', () => {
  let t = tab(6, { weapon: 'sabre', target: 10 });
  t = fenceAll(t, better(t));
  const data = { meta: JSON.parse(JSON.stringify(metaOf(t))), results: resultsOf(t) };
  assert.equal(data.meta.kind, 'tableau');
  const copy = pouleFromShare('ABCDEF', data);
  assert.equal(copy.kind, 'tableau');
  assert.equal(copy.weapon, 'sabre');
  assert.equal(copy.target, 10);
  assert.equal(copy.status, 'finished');
  assert.deepEqual(
    finalRanking(copy).map((r) => r.fencer.id),
    finalRanking(t).map((r) => r.fencer.id),
  );
  assert.equal(copy.share.role, 'member');
});

test('sharing: a remote correction clears dependent results; a stale later result is ignored', () => {
  let t = tab(4);
  t = fenceAll(t, better(t));
  const before = t;
  // Another phone changes semi-final 1 (4 beats 1); the server still has the old final for a moment.
  const remote = { ...resultsOf(t), 'r4-0': { scoreL: 10, scoreR: 15, winnerId: 'f4' } };
  const { poule: next, changed } = applyRemote(t, remote, { full: true });
  assert.ok(changed);
  assert.equal(boutOf(next, 'r4-0').winnerId, 'f4');
  assert.equal(boutOf(next, 'r2-0').winnerId, null, 'old final (1 v 2) no longer fits');
  assert.deepEqual(changedBouts(before, next).sort(), ['r2-0', 'r4-0']);
});

test('a later result is cleared when its opponent changes, even if its winner is still in', () => {
  let t = tab(8);
  t = fenceAll(t, better(t));
  const qf = boutOf(t, 'r8-1'); // 4 v 5, 4 won
  assert.deepEqual([seedOf(t, qf.leftId), seedOf(t, qf.rightId)], [4, 5]);
  t = recordResult(t, qf.id, { scoreL: 13, scoreR: 15 }); // now 5 wins
  const sf = boutOf(t, 'r4-0');
  assert.equal(seedOf(t, sf.leftId), 1);
  assert.equal(seedOf(t, sf.rightId), 5);
  assert.equal(sf.done, false, '1 beat 4, not 5: that result no longer counts');
  assert.equal(t.bouts.find((b) => b.id === 'r4-0').winnerId, null);
  assert.equal(boutOf(t, 'r2-0').done, false);
  // a result naming the wrong pair is refused
  assert.throws(
    () => recordResult(t, 'r4-0', { leftId: 'f1', rightId: 'f4', scoreL: 15, scoreR: 1 }),
    /different pair/,
  );
});
