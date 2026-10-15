// Live sync for shared poules, over the Firebase Realtime Database REST API
// (plain fetch + EventSource, no SDK). Results are written per bout; changes
// from other phones stream in and are merged into the local copy. Anything
// entered offline is kept as "pending" and sent when the connection returns.

import { state, subscribe, savePoule, deletePoule, notify } from './state.js';
import { SHARE_DB_URL } from './config.js';
import { makeCode, normalizeCode, metaOf, resultsOf, resultOf, applyRemote, pouleFromShare } from './core/share.js';

const OVERRIDE_KEY = 'piste:shareDbUrl'; // lets tests / self-hosters point elsewhere

export function serverUrl() {
  let url = SHARE_DB_URL;
  try {
    url = localStorage.getItem(OVERRIDE_KEY) || url;
  } catch {
    /* storage blocked */
  }
  return String(url || '').replace(/\/+$/, '');
}

export const sharingEnabled = () => Boolean(serverUrl());

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${serverUrl()}/${path}.json`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout?.(12_000),
      cache: 'no-store',
    });
  } catch {
    throw new HttpError(0, 'No connection to the sharing server');
  }
  if (!res.ok)
    throw new HttpError(
      res.status,
      res.status === 401 || res.status === 403 ? 'Permission denied' : `Server error ${res.status}`,
    );
  return res.json();
}

const byCode = (code) => [...state.poules.values()].find((p) => p.share?.code === code);

/** A random secret that proves this phone created the shared poule. */
function ownerSecret() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('');
}

/** Share a local poule. Returns the new code. */
export async function sharePoule(p) {
  if (p.share) return p.share.code;
  let code = null;
  const ownerKey = ownerSecret();
  for (let attempt = 0; attempt < 6 && !code; attempt++) {
    const candidate = makeCode();
    try {
      // One atomic write: the poule, plus the owner key (which nobody can
      // read back). The server only lets `meta` be written once, so a code
      // that's already taken is refused.
      await request('PATCH', '', {
        [`poules/${candidate}/meta`]: metaOf(p),
        [`owners/${candidate}/${ownerKey}`]: true,
      });
      code = candidate;
    } catch (e) {
      if (e.status !== 401 && e.status !== 403) throw e;
    }
  }
  if (!code) throw new Error('Could not create a code, please try again');
  const results = resultsOf(p);
  if (Object.keys(results).length) await request('PATCH', `poules/${code}/results`, results);
  const latest = state.poules.get(p.id) ?? p;
  savePoule({ ...latest, share: { code, role: 'owner', ownerKey, pending: {} } }, { fromRemote: true });
  return code;
}

/** Organiser only: delete the shared poule from the server (and so from every phone). */
export async function deleteForEveryone(p) {
  const { code, ownerKey } = p.share ?? {};
  if (!ownerKey) throw new Error('Only the phone that shared this poule can delete it for everyone');
  await request('PATCH', '', { [`poules/${code}`]: null, [`deletions/${code}`]: ownerKey });
  streams.get(code)?.es.close();
  streams.delete(code);
  deletePoule(p.id);
}

export const isOwner = (p) => Boolean(p.share?.ownerKey);

/** Join a shared poule by code (or pasted link). Returns the local poule. */
export async function joinByCode(input) {
  const code = normalizeCode(input);
  if (!code) throw new Error('That doesn’t look like a code (6 letters/numbers)');
  const existing = byCode(code);
  if (existing) return existing;
  const data = await request('GET', `poules/${code}`);
  if (!data) throw new Error(`No poule with code ${code}`);
  const p = pouleFromShare(code, data);
  const sameId = state.poules.get(p.id);
  if (sameId) return sameId; // e.g. the organiser's own phone
  savePoule(p, { fromRemote: true });
  return p;
}

/* ---------- live streams ---------- */

const streams = new Map(); // code -> { es, status }

export function syncStatus(p) {
  const pending = Object.keys(p.share?.pending ?? {}).length;
  const s = streams.get(p.share?.code)?.status ?? 'offline';
  return { status: navigator.onLine === false ? 'offline' : s, pending };
}

function setStatus(code, status) {
  const s = streams.get(code);
  if (!s || s.status === status) return;
  s.status = status;
  notify({ type: 'sync', code });
}

function onEvent(code, kind, e) {
  let msg;
  try {
    msg = JSON.parse(e.data);
  } catch {
    return;
  }
  const p = byCode(code);
  if (!p || !msg) return;
  setStatus(code, 'live');
  // The stream watches the whole poule: '/', '/meta…' or '/results…'.
  const parts = String(msg.path ?? '/')
    .split('/')
    .filter(Boolean);
  let result = null;
  if (!parts.length) {
    if (kind === 'put' && msg.data == null) return remoteDeleted(code);
    if (kind === 'put') result = applyRemote(p, msg.data.results ?? {}, { full: true });
    else if (msg.data?.results) result = applyRemote(p, msg.data.results, {});
  } else if (parts[0] === 'results') {
    if (parts.length === 1) result = applyRemote(p, msg.data ?? {}, { full: kind === 'put' });
    else if (parts.length === 2) result = applyRemote(p, { [parts[1]]: msg.data }, {});
    else return refetch(code); // a field-level change: fetch the results again
  }
  if (result?.changed) savePoule(result.poule, { fromRemote: true });
  if (kind === 'put' && !parts.length) flush(code);
}

/** The organiser deleted the poule for everyone: remove our copy too. */
function remoteDeleted(code) {
  const p = byCode(code);
  if (!p) return;
  streams.get(code)?.es.close();
  streams.delete(code);
  deletePoule(p.id);
  notify({ type: 'remote-deleted', name: p.name });
}

async function refetch(code) {
  try {
    const data = await request('GET', `poules/${code}/results`);
    const p = byCode(code);
    if (!p) return;
    const r = applyRemote(p, data ?? {}, { full: true });
    if (r.changed) savePoule(r.poule, { fromRemote: true });
  } catch {
    /* next event will catch up */
  }
}

function open(code) {
  if (typeof EventSource === 'undefined') return;
  const es = new EventSource(`${serverUrl()}/poules/${code}.json`);
  const entry = { es, status: 'connecting' };
  streams.set(code, entry);
  es.addEventListener('put', (e) => onEvent(code, 'put', e));
  es.addEventListener('patch', (e) => onEvent(code, 'patch', e));
  es.addEventListener('open', () => setStatus(code, 'live'));
  es.addEventListener('error', () => setStatus(code, 'offline')); // EventSource retries by itself
  es.addEventListener('cancel', () => setStatus(code, 'offline'));
}

/** Keep one stream open per shared poule on this phone. */
function reconcile() {
  if (!sharingEnabled() || navigator.onLine === false) return;
  const wanted = new Set([...state.poules.values()].filter((p) => p.share).map((p) => p.share.code));
  for (const [code, s] of streams) {
    if (!wanted.has(code)) {
      s.es.close();
      streams.delete(code);
    }
  }
  for (const code of wanted) if (!streams.has(code)) open(code);
}

/* ---------- sending local changes ---------- */

const flushing = new Set();

async function flush(code) {
  if (flushing.has(code) || !sharingEnabled()) return;
  flushing.add(code);
  try {
    for (;;) {
      const p = byCode(code);
      const ids = Object.keys(p?.share?.pending ?? {});
      if (!ids.length) break;
      const id = ids[0];
      const b = p.bouts.find((x) => x.id === id);
      const r = b ? resultOf(b) : null;
      try {
        if (r) await request('PUT', `poules/${code}/results/${id}`, r);
        else await request('DELETE', `poules/${code}/results/${id}`);
      } catch (e) {
        if (e.status === 0) break; // offline: try again later
        // Rejected by the server (e.g. invalid): drop it rather than retry forever.
      }
      const now = byCode(code);
      if (!now) break;
      // Only clear the flag if the result didn't change again meanwhile.
      const cur = now.bouts.find((x) => x.id === id);
      const sent = JSON.stringify(r);
      if (JSON.stringify(cur ? resultOf(cur) : null) === sent) {
        const pending = { ...now.share.pending };
        delete pending[id];
        savePoule({ ...now, share: { ...now.share, pending } }, { fromRemote: true });
      }
    }
  } finally {
    flushing.delete(code);
  }
}

function flushAll() {
  for (const p of state.poules.values()) if (p.share && Object.keys(p.share.pending ?? {}).length) flush(p.share.code);
}

export function startSync() {
  subscribe((evt) => {
    if (evt.type !== 'poules') return;
    reconcile();
    flushAll();
  });
  const closeAll = () => {
    for (const s of streams.values()) s.es.close();
    streams.clear();
  };
  // Reopen fresh streams on reconnect: the first event is a full snapshot,
  // after which anything entered offline is sent.
  window.addEventListener('online', () => {
    closeAll();
    reconcile();
    flushAll();
  });
  window.addEventListener('offline', () => {
    closeAll();
    notify({ type: 'sync' });
  });
  reconcile();
  flushAll();
}
