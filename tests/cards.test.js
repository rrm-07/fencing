import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBout, apply } from '../app/js/core/bout.js';

const run = (s, actions) => actions.reduce((st, a) => apply(st, a, 0), s);
const card = (side, c) => ({ type: 'card', side, card: c });
const bout = () => createBout({ leftName: 'Ann', rightName: 'Bo' });

test('yellow card is a warning: no touch awarded', () => {
  const s = run(bout(), [card('left', 'yellow')]);
  assert.equal(s.left.cards.yellow, 1);
  assert.equal(s.right.score, 0);
});

test('red card awards a touch to the opponent', () => {
  const s = run(bout(), [card('left', 'red')]);
  assert.equal(s.left.cards.red, 1);
  assert.equal(s.right.score, 1);
  assert.equal(s.left.score, 0);
});

test('second yellow becomes a red and awards a touch', () => {
  const s = run(bout(), [card('right', 'yellow'), card('right', 'yellow')]);
  assert.equal(s.right.cards.yellow, 1);
  assert.equal(s.right.cards.red, 1);
  assert.equal(s.left.score, 1);
});

test('yellow after a red is another red', () => {
  const s = run(bout(), [card('right', 'red'), card('right', 'yellow')]);
  assert.equal(s.right.cards.red, 2);
  assert.equal(s.left.score, 2);
});

test('a red card touch can win the bout', () => {
  let s = bout();
  for (let i = 0; i < 4; i++) s = apply(s, { type: 'score', side: 'left' });
  s = apply(s, card('right', 'red'));
  assert.equal(s.status, 'over');
  assert.equal(s.winner, 'left');
  assert.equal(s.left.score, 5);
});

test('black card ends the bout: opponent wins', () => {
  let s = run(bout(), [
    { type: 'score', side: 'left' },
    { type: 'score', side: 'left' },
  ]);
  s = apply(s, { type: 'timerToggle' }, 0);
  s = apply(s, card('left', 'black'), 1000);
  assert.equal(s.status, 'over');
  assert.equal(s.winner, 'right');
  assert.equal(s.reason, 'black');
  assert.equal(s.left.cards.black, true);
  assert.equal(s.timer.running, false);
});

test('all card actions can be undone', () => {
  let s = run(bout(), [card('left', 'yellow'), card('left', 'yellow'), card('right', 'black')]);
  s = apply(s, { type: 'undo' });
  assert.equal(s.status, 'active');
  assert.equal(s.right.cards.black, false);
  s = apply(s, { type: 'undo' });
  assert.equal(s.left.cards.red, 0);
  assert.equal(s.right.score, 0);
  assert.equal(s.left.cards.yellow, 1);
  s = apply(s, { type: 'undo' });
  assert.equal(s.left.cards.yellow, 0);
});

test('cards are ignored once the bout is over', () => {
  const s = run(bout(), [card('left', 'black')]);
  assert.equal(apply(s, card('right', 'red')), s);
});
