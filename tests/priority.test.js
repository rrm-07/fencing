import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBout, apply } from '../app/js/core/bout.js';
import { remaining } from '../app/js/core/timer.js';

const level = (o = {}) => {
  let s = createBout({ leftName: 'Ann', rightName: 'Bo', ...o });
  s = apply(s, { type: 'score', side: 'left' }, 0);
  s = apply(s, { type: 'score', side: 'right' }, 0);
  return s;
};

test('time expiring with a leader ends the bout on time', () => {
  let s = createBout({ leftName: 'Ann', rightName: 'Bo' });
  s = apply(s, { type: 'score', side: 'right' }, 0);
  s = apply(s, { type: 'timeExpired' }, 0);
  assert.equal(s.status, 'over');
  assert.equal(s.winner, 'right');
  assert.equal(s.reason, 'time');
});

test('time expiring level offers priority; assigning sets 1:00 and marks the fencer', () => {
  let s = apply(level(), { type: 'timeExpired' }, 0);
  assert.equal(s.status, 'active');
  assert.equal(s.tiedAtTime, true);
  s = apply(s, { type: 'assignPriority', side: 'right' }, 0);
  assert.equal(s.priority, 'right');
  assert.equal(s.priorityMinute, true);
  assert.equal(s.tiedAtTime, false);
  assert.equal(s.timer.remainingMs, 60_000);
  assert.equal(s.timer.presetMs, 60_000, 'reset goes back to the 1:00 preset');
});

test('priority cannot be assigned unless tied at time', () => {
  const s = level();
  assert.equal(apply(s, { type: 'assignPriority', side: 'left' }), s);
});

test('if time runs out again level, the fencer with priority wins', () => {
  let s = apply(level(), { type: 'timeExpired' }, 0);
  s = apply(s, { type: 'assignPriority', side: 'left' }, 0);
  s = apply(s, { type: 'timerToggle' }, 0);
  s = apply(s, { type: 'timeExpired' }, 60_000);
  assert.equal(s.status, 'over');
  assert.equal(s.winner, 'left');
  assert.equal(s.reason, 'priority');
  assert.equal(s.left.score, 1);
  assert.equal(s.right.score, 1);
});

test('first touch in the priority minute wins', () => {
  let s = apply(level(), { type: 'timeExpired' }, 0);
  s = apply(s, { type: 'assignPriority', side: 'left' }, 0);
  s = apply(s, { type: 'score', side: 'right' }, 0);
  assert.equal(s.status, 'over');
  assert.equal(s.winner, 'right');
  assert.equal(s.reason, 'priority');
});

test('a red card in the priority minute decides the bout', () => {
  let s = apply(level(), { type: 'timeExpired' }, 0);
  s = apply(s, { type: 'assignPriority', side: 'left' }, 0);
  s = apply(s, { type: 'card', side: 'left', card: 'red' }, 0);
  assert.equal(s.winner, 'right');
});

test('épée doubles are annulled during the priority minute', () => {
  let s = apply(level({ weapon: 'epee' }), { type: 'timeExpired' }, 0);
  s = apply(s, { type: 'assignPriority', side: 'left' }, 0);
  assert.equal(apply(s, { type: 'double' }), s);
});

test('a late touch recorded after time expired level ends the bout', () => {
  let s = apply(level(), { type: 'timeExpired' }, 0);
  s = apply(s, { type: 'score', side: 'left' }, 0);
  assert.equal(s.status, 'over');
  assert.equal(s.winner, 'left');
  assert.equal(s.reason, 'time');
});

test('priority survives a side swap and can be undone', () => {
  let s = apply(level(), { type: 'timeExpired' }, 0);
  s = apply(s, { type: 'assignPriority', side: 'left' }, 0);
  s = apply(s, { type: 'swap' }, 0);
  assert.equal(s.priority, 'right');
  assert.equal(s.right.name, 'Ann');
  s = apply(s, { type: 'undo' }, 0);
  s = apply(s, { type: 'undo' }, 0);
  assert.equal(s.priority, null);
  assert.equal(s.tiedAtTime, true);
});

test('DE: period 1 and 2 expiry leads to a break, period 3 to priority', () => {
  let s = createBout({ leftName: 'A', rightName: 'B', target: 15 });
  assert.equal(s.de, true);
  s = apply(s, { type: 'timeExpired' }, 0);
  assert.equal(s.periodEnded, true);
  assert.equal(s.status, 'active');
  s = apply(s, { type: 'startBreak' }, 1000);
  assert.equal(s.phase, 'break');
  assert.equal(s.timer.running, true);
  assert.equal(remaining(s.timer, 31_000), 30_000);
  s = apply(s, { type: 'timeExpired' }, 61_000); // end of break
  assert.equal(s.phase, 'fence');
  assert.equal(s.period, 2);
  assert.equal(s.timer.remainingMs, 180_000);
  s = apply(s, { type: 'timeExpired' }, 0);
  s = apply(s, { type: 'nextPeriod' }, 0); // skip the break
  assert.equal(s.period, 3);
  s = apply(s, { type: 'timeExpired' }, 0);
  assert.equal(s.tiedAtTime, true);
});

test('sabre DE: break at 8 touches', () => {
  let s = createBout({ weapon: 'sabre', target: 15 });
  assert.equal(s.showTimer, false);
  for (let i = 0; i < 8; i++) s = apply(s, { type: 'score', side: 'left' }, 0);
  assert.equal(s.periodEnded, true);
  s = apply(s, { type: 'nextPeriod' }, 0);
  assert.equal(s.period, 2);
  s = apply(s, { type: 'score', side: 'left' }, 0);
  assert.equal(s.periodEnded, false);
});
