import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBout,
  apply,
  resultText,
  toRecord,
  doubleBlocked,
  HISTORY_LIMIT,
  isStarted,
} from '../app/js/core/bout.js';

const run = (s, actions, now = 0) => actions.reduce((st, a) => apply(st, a, now), s);
const hit = (side, n = 1) => Array.from({ length: n }, () => ({ type: 'score', side }));
const bout = (o = {}) => createBout({ leftName: 'Ann', rightName: 'Bo', now: 0, ...o });

test('tap adds a touch, −1 removes one, never below zero', () => {
  let s = run(bout(), [...hit('left', 2), { type: 'score', side: 'left', delta: -1 }]);
  assert.equal(s.left.score, 1);
  s = run(s, [{ type: 'score', side: 'right', delta: -1 }]);
  assert.equal(s.right.score, 0);
  assert.equal(s.history.length, 3, 'no-op −1 is not recorded');
});

test('reaching the target ends the bout and stops the clock', () => {
  let s = apply(bout(), { type: 'timerToggle' }, 0);
  s = run(s, [...hit('left', 4), ...hit('right', 3)], 1000);
  s = apply(s, { type: 'score', side: 'left' }, 2000);
  assert.equal(s.status, 'over');
  assert.equal(s.winner, 'left');
  assert.equal(s.reason, 'target');
  assert.equal(s.timer.running, false);
  assert.equal(s.timer.remainingMs, 180_000 - 2000);
  assert.equal(resultText(s), 'Ann wins 5–3');
  // Further touches are ignored once over.
  assert.equal(apply(s, { type: 'score', side: 'right' }), s);
});

test('undo reverses the bout-ending touch, then confirm locks it', () => {
  let s = run(bout(), hit('left', 5));
  assert.equal(s.status, 'over');
  s = apply(s, { type: 'undo' });
  assert.equal(s.status, 'active');
  assert.equal(s.left.score, 4);
  s = run(s, [...hit('left'), { type: 'confirm' }], 5000);
  assert.equal(s.status, 'confirmed');
  assert.equal(s.finishedAt, 5000);
  assert.equal(apply(s, { type: 'undo' }), s, 'confirmed bouts cannot be undone');
});

test('undo history holds at least 50 steps of any kind', () => {
  assert.ok(HISTORY_LIMIT >= 50);
  let s = bout({ target: 100 });
  s = run(s, hit('left', 30));
  s = run(s, [{ type: 'card', side: 'right', card: 'yellow' }, { type: 'timerSet', ms: 42_000 }, { type: 'swap' }]);
  s = run(s, hit('left', 20));
  // 30 + 3 + 20 = 53 actions; undo all of them.
  for (let i = 0; i < 53; i++) s = apply(s, { type: 'undo' });
  assert.equal(s.left.score, 0);
  assert.equal(s.right.score, 0);
  assert.equal(s.left.name, 'Ann');
  assert.equal(s.right.cards.yellow, 0);
  assert.equal(s.timer.remainingMs, 180_000);
  assert.equal(s.history.length, 0);
});

test('undo of a score does not rewind the clock; undo of a reset does', () => {
  let s = apply(bout(), { type: 'timerToggle' }, 0);
  s = apply(s, { type: 'timerToggle' }, 50_000); // stopped at 2:10
  s = apply(s, { type: 'score', side: 'left' }, 51_000);
  s = apply(s, { type: 'timerToggle' }, 52_000);
  s = apply(s, { type: 'timerToggle' }, 62_000); // 2:00 left
  s = apply(s, { type: 'undo' }, 63_000); // undo the touch
  assert.equal(s.left.score, 0);
  assert.equal(s.timer.remainingMs, 120_000);
  s = apply(s, { type: 'timerReset' }, 64_000);
  assert.equal(s.timer.remainingMs, 180_000);
  s = apply(s, { type: 'undo' }, 65_000);
  assert.equal(s.timer.remainingMs, 120_000);
  assert.equal(s.timer.running, false);
});

test('double: épée only, +1 each in one undoable action', () => {
  assert.equal(apply(bout({ weapon: 'foil' }), { type: 'double' }).left.score, 0);
  let s = apply(bout({ weapon: 'epee' }), { type: 'double' });
  assert.deepEqual([s.left.score, s.right.score], [1, 1]);
  s = apply(s, { type: 'undo' });
  assert.deepEqual([s.left.score, s.right.score], [0, 0]);
});

test('double at 4–4 is annulled; double at 4–3 wins', () => {
  let s = run(bout({ weapon: 'epee' }), [...hit('left', 4), ...hit('right', 4)]);
  assert.ok(doubleBlocked(s));
  assert.equal(apply(s, { type: 'double' }), s);
  s = run(bout({ weapon: 'epee' }), [...hit('left', 4), ...hit('right', 3), { type: 'double' }]);
  assert.equal(s.status, 'over');
  assert.equal(resultText(s), 'Ann wins 5–4');
});

test('swap sides moves names, scores and cards together', () => {
  let s = run(bout(), [...hit('left', 3), { type: 'card', side: 'left', card: 'yellow' }, { type: 'swap' }]);
  assert.equal(s.left.name, 'Bo');
  assert.equal(s.right.name, 'Ann');
  assert.equal(s.right.score, 3);
  assert.equal(s.right.cards.yellow, 1);
  assert.equal(s.left.cards.yellow, 0);
});

test('names are editable and undoable; blank names are ignored', () => {
  let s = apply(bout(), { type: 'setName', side: 'left', name: '  Alice ' });
  assert.equal(s.left.name, 'Alice');
  assert.equal(apply(s, { type: 'setName', side: 'left', name: '   ' }), s);
  assert.equal(apply(s, { type: 'undo' }).left.name, 'Ann');
});

test('isStarted only after something happened', () => {
  assert.equal(isStarted(bout()), false);
  assert.equal(isStarted(run(bout(), hit('left'))), true);
});

test('toRecord captures ids, scores, winner and the action log', () => {
  const s = run(
    createBout({ leftName: 'A', rightName: 'B', leftId: 'a', rightId: 'b' }),
    [...hit('right', 5), { type: 'confirm' }],
    9,
  );
  const r = toRecord(s);
  assert.equal(r.winnerId, 'b');
  assert.equal(r.scoreR, 5);
  assert.equal(r.history.length, 5);
  assert.equal(r.history[0], '+1 B');
});
