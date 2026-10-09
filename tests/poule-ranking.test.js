import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPoule,
  recordResult,
  clearResult,
  findBout,
  stats,
  ranking,
  rankLabel,
  cellText,
  nextBout,
  progress,
  toCsv,
  validateResult,
  formatVM,
  duplicatePoule,
} from '../app/js/core/poule.js';

const fencers = (n) => Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, name: `F${i + 1}` }));

/** Record a result given as "row beats col a–b" regardless of bout orientation. */
function win(p, winner, loser, ws, ls) {
  const b = findBout(p, winner, loser);
  return recordResult(p, b.id, { leftId: winner, rightId: loser, scoreL: ws, scoreR: ls, winnerId: winner });
}

test('cell text is from the row fencer point of view', () => {
  let p = createPoule({ name: 'P', fencers: fencers(3) });
  p = win(p, 'f2', 'f1', 5, 3);
  assert.equal(cellText(p, 'f2', 'f1'), 'V5');
  assert.equal(cellText(p, 'f1', 'f2'), 'D3');
  assert.equal(cellText(p, 'f1', 'f3'), '');
  assert.equal(cellText(p, 'f1', 'f1'), null);
});

test('indicators: V, M, V/M, TS, TR, Ind', () => {
  let p = createPoule({ name: 'P', fencers: fencers(4) });
  p = win(p, 'f1', 'f2', 5, 2);
  p = win(p, 'f1', 'f3', 5, 4);
  p = win(p, 'f3', 'f2', 5, 0);
  const s = stats(p);
  assert.deepEqual(
    { V: s.get('f1').V, M: s.get('f1').M, TS: s.get('f1').TS, TR: s.get('f1').TR, Ind: s.get('f1').Ind },
    { V: 2, M: 2, TS: 10, TR: 6, Ind: 4 },
  );
  assert.equal(s.get('f1').VM, 1);
  assert.equal(s.get('f2').V, 0);
  assert.equal(s.get('f2').TR, 10);
  assert.equal(s.get('f2').Ind, -8);
  assert.equal(s.get('f3').VM, 0.5);
  assert.equal(s.get('f4').M, 0);
  assert.equal(formatVM(2 / 3), '.667');
  assert.equal(formatVM(1), '1.000');
});

test('ranking: V/M first, then indicator, then touches scored', () => {
  let p = createPoule({ name: 'P', fencers: fencers(4) });
  // f1 beats everyone. f2, f3, f4 each win one: a cycle, separated by Ind/TS.
  p = win(p, 'f1', 'f2', 5, 0);
  p = win(p, 'f1', 'f3', 5, 0);
  p = win(p, 'f1', 'f4', 5, 0);
  p = win(p, 'f2', 'f3', 5, 1); // f2 Ind: -5 +4 = ...
  p = win(p, 'f3', 'f4', 5, 4);
  p = win(p, 'f4', 'f2', 5, 3);
  const r = ranking(p);
  assert.equal(r[0].id, 'f1');
  assert.equal(r[0].rank, 1);
  // f2: TS 0+5+3=8, TR 5+1+5=11 → -3. f3: TS 0+1+5=6, TR 5+5+4=14 → -8. f4: TS 0+4+5=9, TR 5+5+3=13 → -4.
  assert.deepEqual(
    r.map((x) => x.id),
    ['f1', 'f2', 'f4', 'f3'],
  );
  assert.ok(r.every((x) => !x.tied));
});

test('ranking: equal Ind separated by touches scored', () => {
  let p = createPoule({ name: 'P', fencers: fencers(3) });
  p = win(p, 'f1', 'f2', 5, 4); // f1 +1
  p = win(p, 'f2', 'f3', 5, 3); // f2: TS 9 TR 8 → +1
  p = win(p, 'f3', 'f1', 5, 3); // f3: TS 8 TR 8 → 0 ; f1: TS 8 TR 9 → -1
  const r = ranking(p);
  // All 1 V of 2. Ind: f2 +1, f3 0, f1 -1.
  assert.deepEqual(
    r.map((x) => x.id),
    ['f2', 'f3', 'f1'],
  );
});

test('ranking: true ties share a rank and the next rank is skipped', () => {
  let p = createPoule({ name: 'P', fencers: fencers(3) });
  p = win(p, 'f1', 'f2', 5, 3);
  p = win(p, 'f2', 'f3', 5, 3);
  p = win(p, 'f3', 'f1', 5, 3);
  const r = ranking(p);
  assert.ok(r.every((x) => x.rank === 1 && x.tied));
  assert.equal(rankLabel(r[0]), '1=');

  let q = createPoule({ name: 'Q', fencers: fencers(4) });
  q = win(q, 'f1', 'f2', 5, 0);
  q = win(q, 'f1', 'f3', 5, 0);
  q = win(q, 'f1', 'f4', 5, 0);
  q = win(q, 'f2', 'f3', 5, 2);
  q = win(q, 'f3', 'f4', 5, 2);
  q = win(q, 'f4', 'f2', 5, 2);
  const rq = ranking(q);
  assert.deepEqual(rq.map(rankLabel), ['1', '2=', '2=', '2=']);
});

test('ranking: V/M handles fencers with different numbers of bouts fenced', () => {
  let p = createPoule({ name: 'P', fencers: fencers(4) });
  p = win(p, 'f1', 'f2', 5, 0); // f1 1/1
  p = win(p, 'f3', 'f4', 5, 0); // f3 1/1
  p = win(p, 'f3', 'f2', 5, 4); // f3 2/2
  p = win(p, 'f4', 'f1', 5, 4); // f1 1/2, f4 1/2
  const r = ranking(p);
  assert.equal(r[0].id, 'f3');
  assert.equal(r[0].VM, 1);
  // f1: 1/2, Ind 5+4-5=+4... f1 TS 9 TR 5 → +4 ; f4 TS 5 TR 9 → -4
  assert.equal(r[1].id, 'f1');
  assert.equal(r[2].id, 'f4');
  assert.equal(r[3].id, 'f2');
  // Fencer with no bouts fenced ranks by V/M = 0 without crashing.
  const empty = ranking(createPoule({ name: 'E', fencers: fencers(3) }));
  assert.ok(empty.every((x) => x.rank === 1 && x.tied));
});

test('priority win at level score counts as V for the winner', () => {
  let p = createPoule({ name: 'P', fencers: fencers(3) });
  const b = findBout(p, 'f1', 'f2');
  assert.equal(validateResult(b, { scoreL: 4, scoreR: 4 }).ok, false);
  p = recordResult(p, b.id, { scoreL: 4, scoreR: 4, winnerId: 'f2' });
  assert.equal(cellText(p, 'f2', 'f1'), 'V4');
  assert.equal(cellText(p, 'f1', 'f2'), 'D4');
  assert.equal(stats(p).get('f2').V, 1);
});

test('results written from a swapped scorer are normalised', () => {
  let p = createPoule({ name: 'P', fencers: fencers(3) });
  const b = p.bouts[0]; // f1 (left) v f2 (right)
  p = recordResult(p, b.id, { leftId: 'f2', rightId: 'f1', scoreL: 5, scoreR: 1, winnerId: 'f2' });
  const saved = p.bouts[0];
  assert.equal(saved.scoreL, 1);
  assert.equal(saved.scoreR, 5);
  assert.equal(saved.winnerId, 'f2');
});

test('next bout, progress, finish and clear', () => {
  let p = createPoule({ name: 'P', fencers: fencers(3) });
  assert.equal(nextBout(p).n, 1);
  for (const b of p.bouts) p = recordResult(p, b.id, { scoreL: 5, scoreR: 2 });
  assert.equal(p.status, 'finished');
  assert.equal(nextBout(p), null);
  assert.deepEqual(progress(p), { done: 3, total: 3 });
  p = clearResult(p, p.bouts[1].id);
  assert.equal(p.status, 'active');
  assert.equal(nextBout(p).n, 2);
});

test('duplicate keeps fencers and resets results', () => {
  let p = createPoule({ name: 'Sat', fencers: fencers(4), weapon: 'sabre' });
  p = recordResult(p, p.bouts[0].id, { scoreL: 5, scoreR: 2 });
  const d = duplicatePoule(p);
  assert.notEqual(d.id, p.id);
  assert.equal(d.weapon, 'sabre');
  assert.deepEqual(d.fencerIds, p.fencerIds);
  assert.ok(d.bouts.every((b) => b.winnerId == null));
});

test('CSV export contains grid, indicators and escaped names', () => {
  let p = createPoule({
    name: 'Club, "night"',
    fencers: [
      { id: 'a', name: 'Ann' },
      { id: 'b', name: 'Bo' },
      { id: 'c', name: 'Cy', club: 'Ealing' },
    ],
  });
  p = win(p, 'a', 'b', 5, 1);
  const csv = toCsv(p);
  assert.match(csv, /^"Club, ""night""",/);
  assert.match(csv, /1,Ann,,X,V5,,1,1\.000,5,1,4,1/);
  assert.match(csv, /2,Bo,,D1,X,,0,\.000,1,5,-4,3/);
  assert.match(csv, /Bout,Left,Right,Score L,Score R,Winner/);
});
