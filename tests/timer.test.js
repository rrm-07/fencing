import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../app/js/core/timer.js';
import { createBout, apply } from '../app/js/core/bout.js';

test('remaining time is computed from timestamps, not ticks', () => {
  let t = T.start(T.createTimer(180_000), 1_000);
  // Irregular "ticks" while in the foreground.
  for (const now of [1_016, 1_033, 1_100, 2_000, 5_500]) {
    assert.equal(T.remaining(t, now), 180_000 - (now - 1_000));
  }
  // App is backgrounded / screen locks: no ticks at all for 95 s.
  const back = 5_500 + 95_000;
  assert.equal(T.remaining(t, back), 180_000 - (back - 1_000));
  t = T.stop(t, back);
  assert.equal(t.remainingMs, 80_500);
  // Paused time does not drain, however long we wait.
  assert.equal(T.remaining(t, back + 1e9), 80_500);
});

test('a background gap past zero clamps to 0:00 and reads as expired', () => {
  const t = T.start(T.createTimer(60_000), 0);
  assert.equal(T.isExpired(t, 59_999), false);
  assert.equal(T.remaining(t, 10 * 60_000), 0);
  assert.equal(T.isExpired(t, 10 * 60_000), true);
});

test('repeated start/stop accumulates exactly', () => {
  let t = T.createTimer(180_000);
  let now = 0;
  for (let i = 0; i < 100; i++) {
    t = T.start(t, now);
    now += 1_234; // fence
    t = T.stop(t, now);
    now += 5_000; // halt
  }
  assert.equal(t.remainingMs, 180_000 - 123_400);
});

test('timer state survives a reload (serialisation round-trip)', () => {
  const t = T.start(T.createTimer(180_000), 1_000);
  const restored = JSON.parse(JSON.stringify(t));
  assert.equal(T.remaining(restored, 61_000), 120_000);
});

test('bout expires correctly after simulated background/foreground', () => {
  let s = createBout({ leftName: 'A', rightName: 'B' });
  s = apply(s, { type: 'score', side: 'left' }, 0);
  s = apply(s, { type: 'timerToggle' }, 10_000);
  // Screen locked for 4 minutes. On foreground the UI sees the timer expired
  // and dispatches timeExpired.
  const now = 10_000 + 240_000;
  assert.ok(T.isExpired(s.timer, now));
  s = apply(s, { type: 'timeExpired' }, now);
  assert.equal(s.status, 'over');
  assert.equal(s.reason, 'time');
  assert.equal(s.timer.remainingMs, 0);
  assert.equal(s.timer.running, false);
});

test('display: m:ss above 10 s (rounded up), tenths below', () => {
  assert.equal(T.format(180_000), '3:00');
  assert.equal(T.format(179_001), '3:00');
  assert.equal(T.format(179_000), '2:59');
  assert.equal(T.format(10_000), '0:10');
  assert.equal(T.format(9_999), '9.9');
});

test('tenths of a second under 10 s', () => {
  assert.equal(T.format(9_900), '9.9');
  assert.equal(T.format(9_401), '9.5');
  assert.equal(T.format(50), '0.1');
  assert.equal(T.format(0), '0:00');
});

test('parse mm:ss input', () => {
  assert.equal(T.parseMmSs('2:15'), 135_000);
  assert.equal(T.parseMmSs('215'), 135_000);
  assert.equal(T.parseMmSs('45'), 45_000);
  assert.equal(T.parseMmSs('1:5'), 65_000);
  assert.equal(T.parseMmSs(':30'), 30_000);
  assert.equal(T.parseMmSs('1:75'), null);
  assert.equal(T.parseMmSs('abc'), null);
});

test('reset returns to the last preset; setRemaining keeps it', () => {
  let t = T.setPreset(T.createTimer(), 60_000);
  t = T.setRemaining(t, 12_000);
  assert.equal(t.presetMs, 60_000);
  assert.equal(T.reset(t).remainingMs, 60_000);
  assert.equal(T.start(T.setRemaining(t, 0), 0).running, false, 'cannot start at 0:00');
});
