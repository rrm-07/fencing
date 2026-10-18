// Shared poules: share codes, the data sent to the sharing server, and merging
// results that arrive from other phones. Pure functions, unit-tested.
//
// Server layout (Firebase Realtime Database):
//   poules/{CODE}/meta              written once by the organiser
//   poules/{CODE}/results/{boutId}  { scoreL, scoreR, winnerId, reason, finishedAt } or absent
// Results are stored per bout, so two people entering different bouts at the
// same time never overwrite each other.

import { isDone, MIN_FENCERS, MAX_FENCERS, boutOrder } from './poule.js';
import * as Tableau from './tableau.js';
import { ops, isTableau } from './kinds.js';

// No 0/O, 1/I/L: easy to read out loud and to type.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function makeCode(rand = Math.random) {
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return c;
}

/** "K7QM4X" → "K7Q-M4X" for display. */
export const formatCode = (code) => `${code.slice(0, 3)}-${code.slice(3)}`;

/** Clean up typed input ("k7q m4x", "K7Q-M4X", a pasted link). Returns null if invalid. */
export function normalizeCode(input) {
  const s = String(input ?? '').trim();
  const fromLink = s.match(/#join\/([A-Za-z0-9-]+)/);
  const raw = (fromLink ? fromLink[1] : s).toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== CODE_LENGTH) return null;
  for (const ch of raw) if (!CODE_ALPHABET.includes(ch)) return null;
  return raw;
}

/** What other phones need to rebuild the poule. */
export function metaOf(p) {
  if (isTableau(p)) return Tableau.metaOf(p);
  return {
    v: 1,
    id: p.id,
    name: p.name,
    date: p.date,
    weapon: p.weapon,
    target: p.target ?? 5,
    fencers: p.fencers.map((f) => ({ id: f.id, name: f.name, club: f.club ?? '' })),
    bouts: p.bouts.map((b) => ({ id: b.id, n: b.n, leftId: b.leftId, rightId: b.rightId })),
    createdAt: p.createdAt,
  };
}

/** A bout's result as stored on the server, or null if not fenced. */
export function resultOf(b) {
  if (!isDone(b)) return null;
  return {
    // Tableau results also say who fenced (later rounds depend on earlier results).
    ...(b.round ? { leftId: b.leftId, rightId: b.rightId } : {}),
    scoreL: b.scoreL,
    scoreR: b.scoreR,
    winnerId: b.winnerId,
    reason: b.reason ?? null,
    finishedAt: b.finishedAt ?? null,
  };
}

export function resultsOf(p) {
  const out = {};
  for (const b of p.bouts) {
    const r = resultOf(b);
    if (r) out[b.id] = r;
  }
  return out;
}

export function sameResult(a, b) {
  if (!a || !b) return !a && !b;
  return (
    a.scoreL === b.scoreL &&
    a.scoreR === b.scoreR &&
    a.winnerId === b.winnerId &&
    (a.leftId ?? null) === (b.leftId ?? null) &&
    (a.rightId ?? null) === (b.rightId ?? null)
  );
}

/** Ids of bouts whose result differs between two versions of a poule. */
export function changedBouts(prev, next) {
  if (!prev) return next.bouts.filter(isDone).map((b) => b.id);
  const before = new Map(prev.bouts.map((b) => [b.id, resultOf(b)]));
  return next.bouts.filter((b) => !sameResult(before.get(b.id) ?? null, resultOf(b))).map((b) => b.id);
}

/**
 * Apply results received from the server.
 *   remote  { boutId: result | null }
 *   full    true when `remote` is the complete set (missing bouts are cleared)
 * Bouts with local changes still waiting to be sent (`share.pending`) are left
 * alone: they will be pushed and win. Returns { poule, changed }.
 */
export function applyRemote(p, remote, { full = false, now = Date.now() } = {}) {
  const pending = p.share?.pending ?? {};
  const data = remote ?? {};
  const { recordResult, clearResult } = ops(p);
  let next = p;
  let changed = false;
  // In order: a tableau's earlier rounds decide who is in the later ones.
  for (const { id } of p.bouts) {
    if (pending[id]) continue;
    if (!full && !(id in data)) continue;
    const b = next.bouts.find((x) => x.id === id);
    const r = data[id] ?? null;
    if (sameResult(resultOf(b), r)) continue;
    try {
      next = r
        ? recordResult(
            next,
            id,
            {
              ...(typeof r.leftId === 'string' && typeof r.rightId === 'string'
                ? { leftId: r.leftId, rightId: r.rightId }
                : {}),
              scoreL: r.scoreL,
              scoreR: r.scoreR,
              winnerId: r.winnerId,
              reason: r.reason ?? null,
              finishedAt: r.finishedAt ?? now,
            },
            now,
          )
        : clearResult(next, id, now);
      changed = true;
    } catch {
      // Malformed result from the server: ignore it.
    }
  }
  return { poule: next, changed };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Validate meta from the server and build a local poule. Throws if unusable. */
export function pouleFromShare(code, data, now = Date.now()) {
  const m = data?.meta;
  if (!m || typeof m !== 'object') throw new Error('No poule with that code');
  if (m.kind === 'tableau') {
    const t = { ...Tableau.fromMeta(m, now), share: { code, role: 'member', pending: {} } };
    return applyRemote(t, data.results ?? {}, { full: true, now }).poule;
  }
  const fencers = (Array.isArray(m.fencers) ? m.fencers : Object.values(m.fencers ?? {}))
    .filter((f) => f && typeof f.id === 'string')
    .map((f) => ({ id: f.id, name: str(f.name, 40) || '?', club: str(f.club, 40) }));
  if (fencers.length < MIN_FENCERS || fencers.length > MAX_FENCERS) throw new Error('This shared poule is damaged');
  const ids = new Set(fencers.map((f) => f.id));
  const bouts = (Array.isArray(m.bouts) ? m.bouts : Object.values(m.bouts ?? {}))
    .filter((b) => b && typeof b.id === 'string' && ids.has(b.leftId) && ids.has(b.rightId))
    .map((b, i) => ({
      id: b.id,
      n: Number.isInteger(b.n) ? b.n : i + 1,
      leftId: b.leftId,
      rightId: b.rightId,
      scoreL: null,
      scoreR: null,
      winnerId: null,
      cards: null,
      history: [],
      finishedAt: null,
    }));
  if (bouts.length !== boutOrder(fencers.length).length) throw new Error('This shared poule is damaged');
  const base = {
    id: str(m.id, 80) || `shared_${code}`,
    name: str(m.name, 60) || 'Shared poule',
    date: /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? m.date : new Date(now).toISOString().slice(0, 10),
    weapon: ['foil', 'epee', 'sabre'].includes(m.weapon) ? m.weapon : 'foil',
    target: Number.isInteger(m.target) && m.target > 0 ? m.target : 5,
    fencerIds: fencers.map((f) => f.id),
    fencers,
    bouts,
    status: 'active',
    createdAt: Number(m.createdAt) || now,
    updatedAt: now,
    share: { code, role: 'member', pending: {} },
  };
  return applyRemote(base, data.results ?? {}, { full: true, now }).poule;
}

/** Mark bouts as waiting to be sent. */
export function withPending(p, boutIds) {
  if (!boutIds.length) return p;
  const pending = { ...(p.share?.pending ?? {}) };
  for (const id of boutIds) pending[id] = true;
  return { ...p, share: { ...p.share, pending } };
}
