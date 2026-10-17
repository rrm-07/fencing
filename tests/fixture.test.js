import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFixture,
  fixtureMatches,
  fixtureResult,
  rematchFixture,
  fixtureCsv,
  recordLeg,
  substitute,
  LEGS,
} from '../app/js/core/team.js';

const squad = (p) => ({
  A: { fencers: [`${p}A1`, `${p}A2`, `${p}A3`], reserve: `${p}AR` },
  B: { fencers: [`${p}B1`, `${p}B2`, `${p}B3`], reserve: `${p}BR` },
});
const fixture = (scoring) =>
  createFixture({
    name: 'BUCS League',
    date: '2026-10-21',
    teamA: { name: 'UCL' },
    teamB: { name: 'KCL' },
    squads: { foil: squad('F'), epee: squad('E'), sabre: squad('S') },
    scoring,
    now: 0,
  });

/** Fence every leg of a match: A takes `a` touches per leg, B takes `b`. */
function fence(m, a, b) {
  for (let n = 1; n <= LEGS; n++) m = recordLeg(m, n, { touchesA: a, touchesB: b }, 0);
  return m;
}

test('a fixture is three team matches, 3 + reserve per weapon per team', () => {
  const ms = fixture();
  assert.deepEqual(
    ms.map((m) => m.weapon),
    ['foil', 'epee', 'sabre'],
  );
  assert.equal(new Set(ms.map((m) => m.fixture.id)).size, 1);
  assert.deepEqual(
    ms.map((m) => m.name),
    ['BUCS League · Foil', 'BUCS League · Épée', 'BUCS League · Sabre'],
  );
  const names = ms.flatMap((m) =>
    ['A', 'B'].flatMap((k) => [...m.teams[k].fencers.map((f) => f.name), m.teams[k].reserve.name]),
  );
  assert.equal(new Set(names).size, 24);
  assert.ok(ms.every((m) => m.teams.A.name === 'UCL' && m.teams.B.name === 'KCL'));
  assert.ok(ms.every((m) => m.kind === 'team' && m.legs.length === 9));
});

test('fixtureMatches picks out and orders a fixture', () => {
  const ms = fixture();
  const other = fixture();
  const all = [other[0], ms[2], ms[0], other[1], ms[1]];
  assert.deepEqual(
    fixtureMatches(all, ms[0].fixture.id).map((m) => m.weapon),
    ['foil', 'epee', 'sabre'],
  );
});

test('weapons scoring: won once a team has two weapons, touches shown as well', () => {
  let [f, e, s] = fixture();
  let r = fixtureResult([f, e, s]);
  assert.equal(r.winner, null);
  assert.equal(r.finished, 0);
  f = fence(f, 5, 3); // UCL 45–27
  r = fixtureResult([f, e, s]);
  assert.deepEqual([r.weaponsA, r.weaponsB, r.winner], [1, 0, null]);
  e = fence(e, 5, 4); // UCL 45–36
  r = fixtureResult([f, e, s]);
  assert.deepEqual([r.weaponsA, r.weaponsB, r.winner, r.decidedBy, r.complete], [2, 0, 'A', 'weapons', false]);
  s = fence(s, 1, 5); // KCL 45–9
  r = fixtureResult([f, e, s]);
  assert.deepEqual([r.weaponsA, r.weaponsB, r.winner, r.complete], [2, 1, 'A', true]);
  assert.deepEqual([r.touchesA, r.touchesB], [45 + 45 + 9, 27 + 36 + 45]);
});

test('touches scoring: aggregate decides, even against weapons won', () => {
  let [f, e, s] = fixture('touches');
  f = fence(f, 5, 4); // A 45–36
  e = fence(e, 5, 4); // A 45–36
  let r = fixtureResult([f, e, s]);
  assert.equal(r.winner, null, 'not until every weapon is fenced');
  s = fence(s, 1, 5); // B 45–9
  r = fixtureResult([f, e, s]);
  assert.deepEqual([r.weaponsA, r.weaponsB], [2, 1]);
  assert.deepEqual([r.touchesA, r.touchesB], [99, 117]);
  assert.equal(r.winner, 'B');
  assert.equal(r.decidedBy, 'touches');
});

test('each weapon keeps its own substitution', () => {
  const [f, e] = fixture();
  const f2 = substitute(f, 'A', f.teams.A.fencers[0].id);
  assert.equal(f2.teams.A.subbed, true);
  assert.equal(e.teams.A.subbed, false);
  assert.ok(f2.legs.some((l) => l.aId === f.teams.A.reserve.id));
});

test('rematch keeps clubs, line-ups and scoring with a new fixture id', () => {
  const ms = fixture('touches');
  const r = rematchFixture([fence(ms[0], 5, 0), ms[1], ms[2]], Date.UTC(2026, 10, 1));
  assert.notEqual(r[0].fixture.id, ms[0].fixture.id);
  assert.equal(r[0].fixture.scoring, 'touches');
  assert.equal(r[0].date, '2026-11-01');
  assert.equal(r[2].teams.B.reserve.name, 'SBR');
  assert.ok(r.every((m) => m.legs.every((l) => l.touchesA == null)));
});

test('fixture CSV has the overall result and every weapon', () => {
  let [f, e, s] = fixture();
  f = fence(f, 5, 3);
  const csv = fixtureCsv([f, e, s]);
  assert.match(csv, /^Team fixture,BUCS League\r\n/);
  assert.match(csv, /Weapons won,UCL 1–0 KCL/);
  assert.match(csv, /Foil,45,27,UCL/);
  assert.match(csv, /Épée,0,0,/);
  assert.equal(csv.match(/^Team match,/gm).length, 3);
  assert.match(csv, /SA1/);
});

test('a weapon needs three fencers per team', () => {
  assert.throws(
    () =>
      createFixture({
        teamA: { name: 'A' },
        teamB: { name: 'B' },
        squads: { foil: squad('F'), epee: { A: { fencers: ['x', 'y'] }, B: squad('E').B }, sabre: squad('S') },
      }),
    /three fencers/,
  );
});
