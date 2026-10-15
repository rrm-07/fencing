import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RELAY_ORDER,
  createTeamMatch,
  legStart,
  score,
  nextLeg,
  recordLeg,
  clearLeg,
  substitute,
  fencerStats,
  fencerById,
  toCsv,
  rematch,
  MATCH_TARGET,
} from '../app/js/core/team.js';
import { createBout, apply, isStarted, doubleBlocked } from '../app/js/core/bout.js';

const match = (reserveA = 'Rae') =>
  createTeamMatch({
    weapon: 'epee',
    teamA: { name: 'Ealing', fencers: ['Ann', 'Bob', 'Cat'], reserve: reserveA },
    teamB: { name: 'Salle Paul', fencers: ['Dan', 'Eve', 'Fay'] },
    now: 0,
  });

test('relay order: nine legs, everyone fences each opponent once', () => {
  assert.equal(RELAY_ORDER.length, 9);
  const pairs = new Set(RELAY_ORDER.map(([a, b]) => `${a}-${b}`));
  assert.equal(pairs.size, 9);
  for (const a of [1, 2, 3]) for (const b of [4, 5, 6]) assert.ok(pairs.has(`${a}-${b}`), `${a}-${b}`);
  for (let p = 1; p <= 6; p++)
    assert.equal(RELAY_ORDER.flat().filter((x) => x === p).length, 3, `position ${p} fences 3 legs`);
  for (let i = 1; i < 9; i++) {
    const shared = RELAY_ORDER[i].filter((x) => RELAY_ORDER[i - 1].includes(x));
    assert.deepEqual(shared, [], `no back-to-back legs at leg ${i + 1}`);
  }
});

test('createTeamMatch builds legs with targets 5..45 and the right fencers', () => {
  const m = match();
  assert.equal(m.name, 'Ealing v Salle Paul');
  assert.deepEqual(
    m.legs.map((l) => l.target),
    [5, 10, 15, 20, 25, 30, 35, 40, 45],
  );
  assert.equal(fencerById(m, m.legs[0].aId).name, 'Cat'); // 3
  assert.equal(fencerById(m, m.legs[0].bId).name, 'Fay'); // 6
  assert.equal(fencerById(m, m.legs[1].aId).name, 'Ann'); // 1
  assert.equal(fencerById(m, m.legs[1].bId).name, 'Eve'); // 5
  assert.throws(
    () => createTeamMatch({ teamA: { fencers: ['a', 'b'] }, teamB: { fencers: ['c', 'd', 'e'] } }),
    /three/,
  );
});

test('scores carry over from leg to leg', () => {
  let m = match();
  m = recordLeg(m, 1, { touchesA: 5, touchesB: 3 });
  m = recordLeg(m, 2, { touchesA: 2, touchesB: 7 });
  assert.deepEqual(legStart(m, 3), { a: 7, b: 10 });
  assert.deepEqual(score(m), { a: 7, b: 10 });
  assert.equal(nextLeg(m).n, 3);
  assert.equal(m.status, 'active');
  // Editing an earlier leg shifts everything after it.
  m = recordLeg(m, 1, { touchesA: 4, touchesB: 5 });
  assert.deepEqual(legStart(m, 3), { a: 6, b: 12 });
});

test('the match is won at 45, or by the leader after nine legs', () => {
  let m = match();
  for (let n = 1; n <= 8; n++) m = recordLeg(m, n, { touchesA: 5, touchesB: 4 });
  assert.equal(m.status, 'active');
  m = recordLeg(m, 9, { touchesA: 5, touchesB: 2 });
  assert.deepEqual(score(m), { a: MATCH_TARGET, b: 34 });
  assert.equal(m.status, 'finished');
  assert.equal(m.winner, 'A');
  assert.equal(nextLeg(m), null);

  let t = match();
  for (let n = 1; n <= 8; n++) t = recordLeg(t, n, { touchesA: 4, touchesB: 4 });
  t = recordLeg(t, 9, { touchesA: 1, touchesB: 3 }); // time: 33–35
  assert.equal(t.winner, 'B');
});

test('level after the last leg needs the priority winner', () => {
  let m = match();
  for (let n = 1; n <= 9; n++) m = recordLeg(m, n, { touchesA: 3, touchesB: 3 });
  assert.equal(m.status, 'active', 'undecided until priority is recorded');
  m = recordLeg(m, 9, { touchesA: 3, touchesB: 3, decided: { winner: 'B', reason: 'priority' } });
  assert.equal(m.status, 'finished');
  assert.equal(m.winner, 'B');
  m = clearLeg(m, 9);
  assert.equal(m.decided, null);
  assert.equal(m.status, 'active');
});

test('a black card ends the match', () => {
  let m = recordLeg(match(), 1, {
    touchesA: 2,
    touchesB: 1,
    reason: 'black',
    decided: { winner: 'B', reason: 'black' },
  });
  assert.equal(m.status, 'finished');
  assert.equal(m.winner, 'B');
});

test('substitution: the reserve takes every remaining leg of the fencer replaced', () => {
  let m = recordLeg(match(), 1, { touchesA: 5, touchesB: 0 });
  const cat = m.teams.A.fencers[2];
  m = substitute(m, 'A', cat.id);
  const rae = m.teams.A.reserve;
  assert.equal(m.legs[0].aId, cat.id, 'fenced legs keep their fencer');
  const catLegs = m.legs.filter((l) => l.n > 1 && l.aPos === 3);
  assert.ok(catLegs.length > 0 && catLegs.every((l) => l.aId === rae.id));
  assert.throws(() => substitute(m, 'A', m.teams.A.fencers[0].id), /already/);
  assert.throws(() => substitute(m, 'B', m.teams.B.fencers[0].id), /No reserve/);
});

test('fencer stats sum each fencer’s legs', () => {
  let m = match();
  m = recordLeg(m, 1, { touchesA: 5, touchesB: 3 }); // Cat v Fay
  m = recordLeg(m, 5, { touchesA: 4, touchesB: 6 }); // Cat v Dan
  const st = fencerStats(m);
  const cat = st.find((s) => s.name === 'Cat');
  assert.deepEqual([cat.legs, cat.TS, cat.TR, cat.Ind], [2, 9, 9, 0]);
  const fay = st.find((s) => s.name === 'Fay');
  assert.deepEqual([fay.TS, fay.TR], [3, 5]);
  assert.equal(st.filter((s) => s.team === 'A').length, 4, 'includes the reserve');
});

test('CSV export lists the result, line-ups, legs and fencers', () => {
  let m = match();
  m = recordLeg(m, 1, { touchesA: 5, touchesB: 3 });
  const csv = toCsv(m);
  assert.match(csv, /Result,Ealing 5–3 Salle Paul/);
  assert.match(csv, /Ealing,Ann,Bob,Cat,Rae/);
  assert.match(csv, /1,5,Cat,Fay,5,3,5,3/);
  assert.match(csv, /Ealing,Cat,1,5,3,2/);
  assert.equal(
    rematch(m).legs.every((l) => l.touchesA == null),
    true,
  );
});

/* ---------- relay legs in the bout scorer ---------- */

const leg = (o) => createBout({ weapon: 'epee', leftId: 'A', rightId: 'B', ...o });

test('relay leg starts from the carried score and ends at its target', () => {
  let s = leg({ scoreL: 7, scoreR: 9, target: 15, relay: { leg: 3, legs: 9, final: false } });
  assert.equal(isStarted(s), false, 'carried score alone is not progress');
  s = apply(s, { type: 'score', side: 'left', delta: -1 });
  assert.equal(s.left.score, 7, '−1 cannot dip into earlier legs');
  for (let i = 0; i < 6; i++) s = apply(s, { type: 'score', side: 'right' });
  assert.equal(s.status, 'over');
  assert.equal(s.right.score, 15);
  assert.equal(s.winner, 'right');
});

test('relay leg: a double to the target ends the leg level (not annulled)', () => {
  let s = leg({ scoreL: 9, scoreR: 9, target: 10, relay: { leg: 2, legs: 9, final: false } });
  assert.equal(doubleBlocked(s), null);
  s = apply(s, { type: 'double' });
  assert.equal(s.status, 'over');
  assert.equal(s.winner, null);
});

test('relay leg: time ends the leg even when level; the last leg goes to priority', () => {
  let s = leg({ scoreL: 12, scoreR: 12, target: 15, relay: { leg: 3, legs: 9, final: false } });
  s = apply(s, { type: 'timeExpired' });
  assert.equal(s.status, 'over');
  assert.equal(s.reason, 'time');
  let f = leg({ scoreL: 40, scoreR: 40, target: 45, relay: { leg: 9, legs: 9, final: true } });
  f = apply(f, { type: 'timeExpired' });
  assert.equal(f.tiedAtTime, true);
  let g = leg({ scoreL: 44, scoreR: 44, target: 45, relay: { leg: 9, legs: 9, final: true } });
  assert.ok(doubleBlocked(g), 'double at 44–44 is annulled in the last leg');
});

test('team cards carry into a leg', () => {
  let s = leg({
    scoreL: 0,
    scoreR: 0,
    target: 5,
    relay: { leg: 1, legs: 9, final: false },
    leftCards: { yellow: 1, red: 0, black: false },
  });
  s = apply(s, { type: 'card', side: 'left', card: 'yellow' });
  assert.equal(s.left.cards.red, 1, 'a team yellow already given makes the next one red');
  assert.equal(s.right.score, 1);
});
