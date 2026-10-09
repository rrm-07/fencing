import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoule, recordResult, findBout, clearResult } from '../app/js/core/poule.js';
import {
  makeCode,
  formatCode,
  normalizeCode,
  metaOf,
  resultsOf,
  changedBouts,
  applyRemote,
  pouleFromShare,
  withPending,
  CODE_ALPHABET,
  CODE_LENGTH,
} from '../app/js/core/share.js';

const fencers = (n) => Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, name: `F${i + 1}` }));
const poule = () => createPoule({ name: 'Club', fencers: fencers(4), weapon: 'epee', now: 1000 });
const win = (p, a, b, sa, sb) => {
  const bout = findBout(p, a, b);
  return recordResult(p, bout.id, { leftId: a, rightId: b, scoreL: sa, scoreR: sb, winnerId: a });
};

test('codes are 6 characters from an unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const c = makeCode();
    assert.equal(c.length, CODE_LENGTH);
    assert.ok([...c].every((ch) => CODE_ALPHABET.includes(ch)));
  }
  assert.ok(!/[01OIL]/.test(CODE_ALPHABET));
  assert.equal(formatCode('K7QM4X'), 'K7Q-M4X');
});

test('typed codes and pasted links are normalised', () => {
  assert.equal(normalizeCode('k7q-m4x'), 'K7QM4X');
  assert.equal(normalizeCode(' K7Q M4X '), 'K7QM4X');
  assert.equal(normalizeCode('https://x.github.io/fencing/app/#join/K7QM4X'), 'K7QM4X');
  assert.equal(normalizeCode('K7QM4'), null, 'too short');
  assert.equal(normalizeCode('K7QM40'), null, '0 is not in the alphabet');
  assert.equal(normalizeCode(''), null);
});

test('a shared poule round-trips through meta + results', () => {
  let p = poule();
  p = win(p, 'f1', 'f2', 5, 3);
  p = win(p, 'f3', 'f4', 4, 4); // won on priority
  const data = JSON.parse(JSON.stringify({ meta: metaOf(p), results: resultsOf(p) }));
  const q = pouleFromShare('K7QM4X', data);
  assert.equal(q.id, p.id);
  assert.equal(q.name, 'Club');
  assert.equal(q.weapon, 'epee');
  assert.deepEqual(q.share, { code: 'K7QM4X', role: 'member', pending: {} });
  assert.deepEqual(resultsOf(q), resultsOf(p));
  assert.deepEqual(
    q.bouts.map((b) => [b.leftId, b.rightId]),
    p.bouts.map((b) => [b.leftId, b.rightId]),
  );
});

test('pouleFromShare rejects missing or damaged data', () => {
  assert.throws(() => pouleFromShare('K7QM4X', null), /No poule/);
  const meta = metaOf(poule());
  assert.throws(() => pouleFromShare('K7QM4X', { meta: { ...meta, fencers: meta.fencers.slice(0, 2) } }), /damaged/);
  assert.throws(() => pouleFromShare('K7QM4X', { meta: { ...meta, bouts: meta.bouts.slice(1) } }), /damaged/);
  // Strings are clamped; unknown weapons fall back.
  const q = pouleFromShare('K7QM4X', { meta: { ...meta, name: 'x'.repeat(500), weapon: 'axe' } });
  assert.equal(q.name.length, 60);
  assert.equal(q.weapon, 'foil');
});

test('changedBouts finds new, edited and cleared results', () => {
  const p0 = poule();
  const p1 = win(p0, 'f1', 'f2', 5, 3);
  const id = findBout(p0, 'f1', 'f2').id;
  assert.deepEqual(changedBouts(p0, p1), [id]);
  assert.deepEqual(changedBouts(p1, p1), []);
  const p2 = win(p1, 'f1', 'f2', 5, 4);
  assert.deepEqual(changedBouts(p1, p2), [id]);
  assert.deepEqual(changedBouts(p2, clearResult(p2, id)), [id]);
});

test('remote results are merged; a full snapshot clears missing bouts', () => {
  const p = win(poule(), 'f1', 'f2', 5, 3);
  const other = findBout(p, 'f3', 'f4');
  const r = { scoreL: 5, scoreR: 1, winnerId: other.leftId, reason: null, finishedAt: 5 };
  let m = applyRemote(p, { [other.id]: r });
  assert.ok(m.changed);
  assert.equal(m.poule.bouts.find((b) => b.id === other.id).scoreL, 5);
  assert.equal(m.poule.bouts.filter((b) => b.winnerId).length, 2, 'partial update keeps other results');
  m = applyRemote(m.poule, { [other.id]: r }, { full: true });
  assert.equal(m.poule.bouts.filter((b) => b.winnerId).length, 1, 'full snapshot is authoritative');
  assert.equal(applyRemote(m.poule, { [other.id]: r }, { full: true }).changed, false, 'no-op when equal');
  // A deleted result (null) clears it.
  m = applyRemote(m.poule, { [other.id]: null });
  assert.equal(m.poule.bouts.filter((b) => b.winnerId).length, 0);
});

test('pending local results are not overwritten by the server', () => {
  let p = { ...win(poule(), 'f1', 'f2', 5, 3), share: { code: 'K7QM4X', role: 'member', pending: {} } };
  const id = findBout(p, 'f1', 'f2').id;
  p = withPending(p, [id]);
  const m = applyRemote(p, {}, { full: true });
  assert.equal(m.changed, false);
  assert.equal(m.poule.bouts.find((b) => b.id === id).scoreL, 5);
});

test('malformed remote results are ignored', () => {
  const p = poule();
  const b = p.bouts[0];
  const m = applyRemote(p, { [b.id]: { scoreL: 5, scoreR: 2, winnerId: 'stranger' } });
  assert.equal(m.changed, false);
  const m2 = applyRemote(p, { [b.id]: { scoreL: -1, scoreR: 2, winnerId: b.leftId } });
  assert.equal(m2.changed, false);
});
