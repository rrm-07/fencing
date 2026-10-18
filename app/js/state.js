// App state: the live bout, poules, roster and settings, kept in memory and
// written through to on-device storage on every change.

import * as store from './store.js';
import { apply, createBout, toRecord, isStarted, uid } from './core/bout.js';
import { createPoule, fencerById } from './core/poule.js';
import { ops, isTableau, boutFor } from './core/kinds.js';
import { changedBouts, withPending } from './core/share.js';
import * as Team from './core/team.js';

export const state = {
  bout: null,
  poules: new Map(),
  matches: new Map(),
  roster: [],
  settings: { theme: 'dark', haptics: true },
};

const subs = new Set();
export const subscribe = (fn) => (subs.add(fn), () => subs.delete(fn));
export const notify = (evt) => subs.forEach((fn) => fn(evt));

export async function load() {
  await store.openStore();
  const [bout, poules, roster, settings, matches] = await Promise.all([
    store.kvGet('bout'),
    store.getAll('poules'),
    store.getAll('fencers'),
    store.kvGet('settings'),
    store.getAll('matches'),
  ]);
  // The live bout is mirrored synchronously to localStorage so that the very
  // last tap survives even if the page is killed before IndexedDB commits.
  const mirror = readMirror();
  const best = [bout, mirror].filter((b) => b && b.left && b.timer).sort((a, b) => (b.rev ?? 0) - (a.rev ?? 0))[0];
  state.bout = best ?? createBout({ leftName: 'Left', rightName: 'Right' });
  state.poules = new Map(poules.map((p) => [p.id, p]));
  state.matches = new Map(matches.map((m) => [m.id, m]));
  state.roster = roster.sort((a, b) => a.name.localeCompare(b.name));
  state.settings = { ...state.settings, ...(settings ?? {}) };

  // If the page died between confirming a poule bout and the poule write
  // committing, the mirrored bout still has the result: write it back.
  const b = state.bout;
  const p = b.status === 'confirmed' && b.pouleRef && state.poules.get(b.pouleRef.pouleId);
  const pb = p && p.bouts.find((x) => x.id === b.pouleRef.boutId);
  if (pb && !pb.winnerId && (p.updatedAt ?? 0) < b.finishedAt) {
    try {
      savePoule(ops(p).recordResult(p, pb.id, toRecord(b), b.finishedAt));
    } catch {
      /* the bracket moved on meanwhile */
    }
  }
  // Same for a relay leg.
  const m = b.status === 'confirmed' && b.teamRef && state.matches.get(b.teamRef.matchId);
  const leg = m && m.legs.find((l) => l.n === b.teamRef.leg);
  if (leg && !Team.legDone(leg) && (m.updatedAt ?? 0) < b.finishedAt) writeLeg(b);
}

/* ---------- bout ---------- */

const MIRROR_KEY = 'piste:bout';

function readMirror() {
  try {
    return JSON.parse(localStorage.getItem(MIRROR_KEY) || 'null');
  } catch {
    return null;
  }
}

function persistBout(b) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(b));
  } catch {
    /* quota or blocked: IndexedDB still has it */
  }
  store.kvSet('bout', b);
}

export function dispatch(action) {
  const prev = state.bout;
  const next = apply(prev, action, Date.now());
  if (next === prev) return false;
  state.bout = { ...next, rev: (prev.rev ?? 0) + 1 };
  persistBout(state.bout);
  notify({ type: 'bout', action, prev });
  return true;
}

export function replaceBout(bout) {
  state.bout = { ...bout, rev: (state.bout?.rev ?? 0) + 1 };
  persistBout(state.bout);
  notify({ type: 'bout', action: { type: 'replace' }, prev: null });
}

export const boutInProgress = () => state.bout.status !== 'confirmed' && isStarted(state.bout);

/** Fresh bout keeping names and format of the current one. */
export function newBout({ keepNames = true } = {}) {
  const b = state.bout;
  replaceBout(
    createBout({
      weapon: b.weapon,
      target: b.relay ? 5 : b.target,
      de: b.relay ? false : b.de,
      showTimer: b.showTimer,
      leftName: keepNames ? b.left.name : 'Left',
      rightName: keepNames ? b.right.name : 'Right',
    }),
  );
}

/**
 * Confirm a finished bout. Poule bouts write their result back to the sheet;
 * free bouts are kept in the bout log. Returns the poule if one was updated.
 */
export function confirmBout() {
  if (!dispatch({ type: 'confirm' })) return null;
  const b = state.bout;
  const rec = toRecord(b);
  if (b.teamRef) return writeLeg(b);
  const ref = b.pouleRef;
  const poule = ref && state.poules.get(ref.pouleId);
  if (poule && poule.bouts.some((x) => x.id === ref.boutId)) {
    try {
      const updated = ops(poule).recordResult(poule, ref.boutId, rec, Date.now());
      savePoule(updated);
      return updated;
    } catch {
      // e.g. a tableau bout whose fencers changed while it was being fenced
    }
  }
  store.put('bouts', { ...rec, pouleId: null });
  return null;
}

/* ---------- team matches ---------- */

/** Write a confirmed relay leg back to its team match. Returns the match. */
function writeLeg(b) {
  const m = state.matches.get(b.teamRef.matchId);
  if (!m) return null;
  const sideOf = (team) => (b.left.id === team ? 'left' : 'right');
  const [a, bb] = [sideOf('A'), sideOf('B')];
  const decided = b.reason === 'black' || b.reason === 'priority' ? { winner: b[b.winner].id, reason: b.reason } : null;
  const updated = Team.recordLeg(
    m,
    b.teamRef.leg,
    {
      touchesA: b[a].score - (b.base?.[a] ?? 0),
      touchesB: b[bb].score - (b.base?.[bb] ?? 0),
      reason: b.reason,
      decided,
      cards: { A: b[a].cards, B: b[bb].cards },
      finishedAt: b.finishedAt,
    },
    Date.now(),
  );
  saveMatch(updated);
  return updated;
}

/** Load a relay leg into the scorer, carrying on the score and team cards. */
export function startTeamLeg(m, leg) {
  const start = Team.legStart(m, leg.n);
  const fa = Team.fencerById(m, leg.aId);
  const fb = Team.fencerById(m, leg.bId);
  replaceBout(
    createBout({
      weapon: m.weapon,
      target: leg.target,
      de: false,
      leftName: fa?.name ?? 'Team A',
      rightName: fb?.name ?? 'Team B',
      leftId: 'A',
      rightId: 'B',
      leftTeam: m.teams.A.name,
      rightTeam: m.teams.B.name,
      scoreL: start.a,
      scoreR: start.b,
      leftCards: m.cards.A,
      rightCards: m.cards.B,
      relay: { leg: leg.n, legs: Team.LEGS, final: leg.n === Team.LEGS },
      teamRef: { matchId: m.id, leg: leg.n },
    }),
  );
}

export function saveMatch(m) {
  state.matches.set(m.id, m);
  store.put('matches', m);
  notify({ type: 'matches', id: m.id });
}

export function deleteMatch(id) {
  state.matches.delete(id);
  store.remove('matches', id);
  if (state.bout.teamRef?.matchId === id) replaceBout({ ...state.bout, teamRef: null, relay: null });
  notify({ type: 'matches', id });
}

/** Load a poule (or tableau) bout into the scorer. */
export function startPouleBout(poule, pb) {
  pb = boutFor(poule, pb.id) ?? pb;
  const L = fencerById(poule, pb.leftId);
  const R = fencerById(poule, pb.rightId);
  const target = poule.target ?? 5;
  replaceBout(
    createBout({
      weapon: poule.weapon,
      target,
      de: isTableau(poule) && target >= 10,
      leftName: L.name,
      rightName: R.name,
      leftId: L.id,
      rightId: R.id,
      pouleRef: { pouleId: poule.id, boutId: pb.id },
    }),
  );
}

/* ---------- poules ---------- */

/**
 * Save a poule. For shared poules, changed results are marked as pending;
 * sync.js sends them to the server. `fromRemote` is used for changes that came
 * from the server (or that only update sharing bookkeeping).
 */
export function savePoule(p, { fromRemote = false } = {}) {
  if (p.share && !fromRemote) p = withPending(p, changedBouts(state.poules.get(p.id), p));
  state.poules.set(p.id, p);
  store.put('poules', p);
  notify({ type: 'poules', id: p.id });
}

export function deletePoule(id) {
  state.poules.delete(id);
  store.remove('poules', id);
  if (state.bout.pouleRef?.pouleId === id) {
    replaceBout({ ...state.bout, pouleRef: null });
  }
  notify({ type: 'poules', id });
}

export function makePoule(fields) {
  const p = createPoule(fields);
  savePoule(p);
  return p;
}

/* ---------- roster ---------- */

const norm = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase();

/** Add (or find) a roster fencer by name + club. */
export function rosterAdd(name, club = '') {
  const existing = state.roster.find((f) => norm(f.name) === norm(name) && norm(f.club) === norm(club));
  if (existing) return existing;
  const f = { id: uid('f'), name: name.trim(), club: club.trim() };
  state.roster = [...state.roster, f].sort((a, b) => a.name.localeCompare(b.name));
  store.put('fencers', f);
  notify({ type: 'roster' });
  return f;
}

export function rosterUpdate(f) {
  state.roster = state.roster.map((x) => (x.id === f.id ? f : x)).sort((a, b) => a.name.localeCompare(b.name));
  store.put('fencers', f);
  notify({ type: 'roster' });
}

export function rosterRemove(id) {
  state.roster = state.roster.filter((f) => f.id !== id);
  store.remove('fencers', id);
  notify({ type: 'roster' });
}

/* ---------- settings & backup ---------- */

export function setSetting(key, value) {
  state.settings = { ...state.settings, [key]: value };
  store.kvSet('settings', state.settings);
  notify({ type: 'settings', key });
}

export async function importBackup(data) {
  const counts = await store.importAll(data);
  await load();
  notify({ type: 'poules' });
  notify({ type: 'matches' });
  notify({ type: 'roster' });
  notify({ type: 'settings' });
  return counts;
}

export const exportBackup = () => store.exportAll();
