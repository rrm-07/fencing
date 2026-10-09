// Bout state machine. `apply(state, action, now)` is a pure reducer: it never
// mutates its input and never reads the clock or Math.random itself (the
// caller passes `now` and any random choice), so every rule is unit-testable.

import * as T from './timer.js';

export const WEAPONS = ['foil', 'epee', 'sabre'];
export const WEAPON_LABEL = { foil: 'Foil', epee: 'Épée', sabre: 'Sabre' };
export const BOUT_MS = 3 * T.MIN;
export const PRIORITY_MS = T.MIN;
export const BREAK_MS = T.MIN;
export const HISTORY_LIMIT = 100;
export const SIDES = ['left', 'right'];

export const other = (side) => (side === 'left' ? 'right' : 'left');

let seq = 0;
export function uid(prefix = 'id') {
  seq = (seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function fencer(name, id = null) {
  return { id, name, score: 0, cards: { yellow: 0, red: 0, black: false } };
}

/**
 * Create a fresh bout.
 * opts: { weapon, target, de, showTimer, leftName, rightName, leftId, rightId, pouleRef }
 */
export function createBout(opts = {}) {
  const weapon = WEAPONS.includes(opts.weapon) ? opts.weapon : 'foil';
  const target = opts.target ?? 5;
  return {
    id: opts.id ?? uid('bout'),
    weapon,
    target,
    de: opts.de ?? target >= 10,
    showTimer: opts.showTimer ?? weapon !== 'sabre',
    left: fencer(opts.leftName ?? 'Left', opts.leftId ?? null),
    right: fencer(opts.rightName ?? 'Right', opts.rightId ?? null),
    timer: T.createTimer(BOUT_MS),
    period: 1,
    phase: 'fence', // 'fence' | 'break'
    periodEnded: false, // DE: a period finished, waiting for break / next period
    tiedAtTime: false, // time expired level: waiting for the priority draw
    priority: null, // 'left' | 'right'
    priorityMinute: false,
    status: 'active', // 'active' | 'over' | 'confirmed'
    winner: null, // 'left' | 'right'
    reason: null, // 'target' | 'time' | 'priority' | 'black'
    pouleRef: opts.pouleRef ?? null, // { pouleId, boutId }
    history: [],
    createdAt: opts.now ?? Date.now(),
    finishedAt: null,
  };
}

/** True once anything has happened, i.e. replacing it would lose work. */
export function isStarted(s) {
  return (
    s.history.length > 0 ||
    s.left.score + s.right.score > 0 ||
    s.timer.running ||
    s.timer.remainingMs !== s.timer.presetMs
  );
}

const UNDOABLE = new Set([
  'score',
  'double',
  'card',
  'swap',
  'setName',
  'timerPreset',
  'timerReset',
  'timerSet',
  'timeExpired',
  'assignPriority',
  'setPeriod',
  'startBreak',
  'nextPeriod',
  'setFormat',
]);
const TIMER_ACTIONS = new Set([
  'timerPreset',
  'timerReset',
  'timerSet',
  'timeExpired',
  'assignPriority',
  'startBreak',
  'nextPeriod',
]);

/** Reducer. Returns the same object when the action is a no-op. */
export function apply(state, action, now = Date.now()) {
  if (action.type === 'undo') return undo(state, now);
  if (action.type === 'timerToggle') return timerToggle(state, now);
  if (action.type === 'confirm') {
    if (state.status !== 'over') return state;
    return { ...state, status: 'confirmed', finishedAt: now };
  }
  if (state.status === 'confirmed') return state;

  const next = reduce(state, action, now);
  if (next === state) return state;
  if (!UNDOABLE.has(action.type)) return next;

  const snapshot = { ...state, timer: T.stop(state.timer, now) };
  delete snapshot.history;
  const entry = { label: describe(state, action), timer: TIMER_ACTIONS.has(action.type), snapshot };
  const history = [...state.history, entry].slice(-HISTORY_LIMIT);
  return { ...next, history };
}

function undo(state, now) {
  if (state.status === 'confirmed' || state.history.length === 0) return state;
  const entry = state.history[state.history.length - 1];
  const restored = { ...entry.snapshot, history: state.history.slice(0, -1) };
  // Score/card undos never touch the clock; timer undos restore it, paused.
  restored.timer = entry.timer ? T.stop(entry.snapshot.timer, now) : state.timer;
  return restored;
}

function timerToggle(s, now) {
  if (s.status !== 'active' || s.tiedAtTime || s.periodEnded) {
    return s.timer.running ? { ...s, timer: T.stop(s.timer, now) } : s;
  }
  return { ...s, timer: T.toggle(s.timer, now) };
}

function setSide(s, side, patch) {
  return { ...s, [side]: { ...s[side], ...patch } };
}

function addScore(s, side, delta) {
  return setSide(s, side, { score: Math.max(0, s[side].score + delta) });
}

function finish(s, winner, reason, now) {
  return { ...s, status: 'over', winner, reason, timer: T.stop(s.timer, now), tiedAtTime: false };
}

/** Decide whether the bout has ended after a score change. */
function evaluate(s, now) {
  if (s.status !== 'active') return s;
  const L = s.left.score;
  const R = s.right.score;
  if ((L >= s.target || R >= s.target) && L !== R) {
    return finish(s, L > R ? 'left' : 'right', 'target', now);
  }
  if (s.priorityMinute && L !== R) return finish(s, L > R ? 'left' : 'right', 'priority', now);
  if (s.tiedAtTime && L !== R) return finish(s, L > R ? 'left' : 'right', 'time', now);
  // Sabre DE: the break comes when the first fencer reaches 8.
  if (s.de && s.weapon === 'sabre' && s.period === 1 && Math.max(L, R) >= 8 && s.target >= 15) {
    return { ...s, periodEnded: true, timer: T.stop(s.timer, now) };
  }
  return s;
}

/** Is a double touch allowed right now? Returns null or a reason string. */
export function doubleBlocked(s) {
  if (s.weapon !== 'epee') return 'Doubles only exist in épée';
  if (s.priorityMinute) return 'Doubles are annulled in the priority minute';
  if (s.left.score === s.target - 1 && s.right.score === s.target - 1) {
    return `Double at ${s.target - 1}–${s.target - 1} is annulled`;
  }
  return null;
}

function reduce(s, a, now) {
  switch (a.type) {
    case 'score': {
      if (s.status !== 'active') return s;
      const delta = a.delta ?? 1;
      if (delta < 0 && s[a.side].score === 0) return s;
      return evaluate(addScore(s, a.side, delta), now);
    }
    case 'double': {
      if (s.status !== 'active' || doubleBlocked(s)) return s;
      return evaluate(addScore(addScore(s, 'left', 1), 'right', 1), now);
    }
    case 'card':
      return card(s, a.side, a.card, now);
    case 'swap':
      return {
        ...s,
        left: s.right,
        right: s.left,
        priority: s.priority && other(s.priority),
        winner: s.winner && other(s.winner),
      };
    case 'setName': {
      const name = String(a.name ?? '').trim();
      if (!name || name === s[a.side].name) return s;
      return setSide(s, a.side, { name });
    }
    case 'timerPreset':
      return { ...s, timer: T.setPreset(s.timer, a.ms) };
    case 'timerReset':
      if (!s.timer.running && s.timer.remainingMs === s.timer.presetMs) return s;
      return { ...s, timer: T.reset(s.timer) };
    case 'timerSet':
      return { ...s, timer: T.setRemaining(s.timer, a.ms) };
    case 'timeExpired':
      return timeExpired(s, now);
    case 'assignPriority':
      if (!s.tiedAtTime || s.status !== 'active') return s;
      return {
        ...s,
        tiedAtTime: false,
        priority: a.side,
        priorityMinute: true,
        timer: T.setPreset(s.timer, PRIORITY_MS),
      };
    case 'setPeriod': {
      const period = Math.min(3, Math.max(1, a.period));
      return period === s.period ? s : { ...s, period };
    }
    case 'startBreak':
      return {
        ...s,
        phase: 'break',
        periodEnded: false,
        timer: T.start(T.setPreset(s.timer, BREAK_MS), now),
      };
    case 'nextPeriod':
      return {
        ...s,
        phase: 'fence',
        periodEnded: false,
        period: Math.min(3, s.period + 1),
        timer: T.setPreset(s.timer, BOUT_MS),
      };
    case 'setFormat': {
      const next = { ...s };
      if (a.weapon && a.weapon !== s.weapon) {
        next.weapon = a.weapon;
        next.showTimer = a.weapon !== 'sabre';
      }
      if (a.target != null) next.target = a.target;
      if (a.de != null) next.de = a.de;
      if (a.showTimer != null) next.showTimer = a.showTimer;
      if (!next.de) next.period = 1;
      return evaluate(next, now);
    }
    default:
      return s;
  }
}

function card(s, side, kind, now) {
  if (s.status !== 'active') return s;
  const opp = other(side);
  const cards = { ...s[side].cards };
  if (kind === 'black') {
    cards.black = true;
    return finish(setSide(s, side, { cards }), opp, 'black', now);
  }
  // A yellow on a fencer who has already been carded becomes a red.
  const asRed = kind === 'red' || cards.yellow > 0 || cards.red > 0;
  if (!asRed) {
    cards.yellow = 1;
    return setSide(s, side, { cards });
  }
  cards.red += 1;
  // A red card awards a touch to the opponent.
  return evaluate(addScore(setSide(s, side, { cards }), opp, 1), now);
}

function timeExpired(s, now) {
  const timer = T.setRemaining(s.timer, 0);
  if (s.phase === 'break') {
    return { ...s, phase: 'fence', period: Math.min(3, s.period + 1), timer: T.setPreset(timer, BOUT_MS) };
  }
  if (s.status !== 'active' || s.tiedAtTime || s.periodEnded) return { ...s, timer };
  const L = s.left.score;
  const R = s.right.score;
  const st = { ...s, timer };
  if (s.priorityMinute) {
    // Still level after the extra minute: the fencer with priority wins.
    const winner = L === R ? s.priority : L > R ? 'left' : 'right';
    return finish(st, winner, 'priority', now);
  }
  if (s.de && s.period < 3) return { ...st, periodEnded: true };
  if (L === R) return { ...st, tiedAtTime: true };
  return finish(st, L > R ? 'left' : 'right', 'time', now);
}

/** Human-readable label for the undo toast / bout log. */
export function describe(s, a) {
  const n = (side) => s[side]?.name ?? side;
  switch (a.type) {
    case 'score':
      return `${(a.delta ?? 1) > 0 ? '+1' : '−1'} ${n(a.side)}`;
    case 'double':
      return 'Double';
    case 'card': {
      const c = s[a.side].cards;
      const promoted = a.card === 'yellow' && (c.yellow > 0 || c.red > 0);
      return `${promoted ? 'Yellow → red' : a.card[0].toUpperCase() + a.card.slice(1)} card ${n(a.side)}`;
    }
    case 'swap':
      return 'Swap sides';
    case 'setName':
      return `Rename ${n(a.side)}`;
    case 'timerPreset':
      return `Clock ${T.formatMmSs(a.ms)}`;
    case 'timerReset':
      return 'Clock reset';
    case 'timerSet':
      return `Clock set ${T.formatMmSs(a.ms)}`;
    case 'timeExpired':
      return 'Time';
    case 'assignPriority':
      return `Priority ${n(a.side)}`;
    case 'setPeriod':
      return `Period ${a.period}`;
    case 'startBreak':
      return 'Break';
    case 'nextPeriod':
      return `Period ${s.period + 1}`;
    case 'setFormat':
      return 'Bout format';
    default:
      return a.type;
  }
}

/** "Alice wins 5–3" from the winner's point of view. */
export function resultText(s) {
  if (!s.winner) return '';
  const w = s[s.winner];
  const l = s[other(s.winner)];
  return `${w.name} wins ${w.score}–${l.score}`;
}

export const REASON_TEXT = {
  target: '',
  time: 'on time',
  priority: 'on priority',
  black: 'black card',
};

/** Compact, storable record of a finished bout (for poules and the log). */
export function toRecord(s) {
  return {
    id: s.id,
    weapon: s.weapon,
    target: s.target,
    leftId: s.left.id,
    rightId: s.right.id,
    leftName: s.left.name,
    rightName: s.right.name,
    scoreL: s.left.score,
    scoreR: s.right.score,
    cards: { left: s.left.cards, right: s.right.cards },
    winner: s.winner,
    winnerId: s.winner ? s[s.winner].id : null,
    reason: s.reason,
    priority: s.priority,
    history: s.history.map((h) => h.label),
    finishedAt: s.finishedAt,
  };
}
