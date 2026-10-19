// Booking data on the club's Firebase Realtime Database (REST + EventSource).
//
//   booking/publicKey, booking/privateKey   organiser keys (see crypto.js)
//   booking/sessions/{date_id}/{bookingId}  { name, enc, createdAt }   public
//   booking/closures/{date_id}/{id}         { closed, reason, at }     public
//   booking/config/{weekly|events|overrides|meta}/{id}   the timetable, organiser-edited, public
//   booking/attendance/{date_id}/{id}       { present, how, at, … }    public (booking id or walk-in id)
//   booking/keys, cancels, admin, adminOps, checkin, attendProofs   proofs checked by the rules, never readable

import { SHARE_DB_URL } from '../js/config.js';
import { applyEvent } from './core.js';

export function serverUrl() {
  let url = SHARE_DB_URL;
  try {
    url = localStorage.getItem('piste:shareDbUrl') || url;
  } catch {
    /* storage blocked */
  }
  return String(url || '').replace(/\/+$/, '');
}

const SERVER_TIME = { '.sv': 'timestamp' };

async function request(method, path, body, query = '') {
  let res;
  try {
    res = await fetch(`${serverUrl()}/${path}.json${query}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout?.(15_000),
    });
  } catch {
    throw new Error('No connection. Check your signal and try again.');
  }
  if (res.status === 401 || res.status === 403) throw new Error('Not allowed (permission denied)');
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export const getKeys = async () => ({
  publicKey: await request('GET', 'booking/publicKey'),
  privateKey: await request('GET', 'booking/privateKey'),
});

/** First-time organiser setup (only works while no organiser exists). */
export function setUp({ publicKey, privateKey, secret }) {
  return request('PATCH', '', {
    'booking/publicKey': publicKey,
    'booking/privateKey': privateKey,
    [`booking/admin/${secret}`]: true,
  });
}

export function book(sessionKey, id, { name, enc }, key) {
  return request('PATCH', '', {
    [`booking/sessions/${sessionKey}/${id}`]: { name, enc, createdAt: SERVER_TIME },
    [`booking/keys/${sessionKey}/${id}/${key}`]: true,
  });
}

/** Cancel your own booking: prove it with the key kept on this phone. */
export function cancel(sessionKey, id, key) {
  return request('PATCH', '', {
    [`booking/sessions/${sessionKey}/${id}`]: null,
    [`booking/cancels/${sessionKey}/${id}`]: key,
  });
}

/** Sign up for an individual lesson with a coach during a session. */
export function lessonSignUp(sessionKey, coachId, id, name, key) {
  return request('PATCH', '', {
    [`booking/lessons/${sessionKey}/${coachId}/${id}`]: { name, createdAt: SERVER_TIME },
    [`booking/lessonKeys/${sessionKey}/${coachId}/${id}/${key}`]: true,
  });
}

export function lessonCancel(sessionKey, coachId, id, key) {
  return request('PATCH', '', {
    [`booking/lessons/${sessionKey}/${coachId}/${id}`]: null,
    [`booking/lessonCancels/${sessionKey}/${coachId}/${id}`]: key,
  });
}

/** Organiser: remove anyone's lesson sign-up. */
export function lessonRemove(sessionKey, coachId, id, secret) {
  return request('PATCH', '', {
    [`booking/lessons/${sessionKey}/${coachId}/${id}`]: null,
    [`booking/adminOps/rmLesson/${sessionKey}/${coachId}/${id}`]: secret,
  });
}

/** Organiser: remove anyone's booking. */
export function removeBooking(sessionKey, id, secret) {
  return request('PATCH', '', {
    [`booking/sessions/${sessionKey}/${id}`]: null,
    [`booking/adminOps/rm/${sessionKey}/${id}`]: secret,
  });
}

/** Organiser: cancel (closed = true) or reopen a session. */
export function setClosed(sessionKey, closed, reason, secret) {
  const cid = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return request('PATCH', '', {
    [`booking/adminOps/close/${sessionKey}/${cid}`]: secret,
    [`booking/closures/${sessionKey}/${cid}`]: { closed, reason: reason || '', at: SERVER_TIME },
  });
}

/**
 * Organiser: write timetable entries. `entries` maps 'weekly/<id>',
 * 'events/<id>', 'overrides/<key>' or 'meta/main' to their new value
 * (use { deleted: true } / { cleared: true } rather than removing).
 * Every entry carries a one-time `op` id that the rules tie to the
 * organiser secret written in the same request.
 */
export function saveTimetable(entries, secret) {
  const op = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const body = { [`booking/adminOps/cfg/${op}`]: secret };
  for (const [path, value] of Object.entries(entries)) body[`booking/config/${path}`] = { ...value, op };
  return request('PATCH', '', body);
}

/**
 * Organiser: write the club page (About tab): 'about' → { links…, tagline },
 * 'photos/<id>' → { src, caption, at } or { deleted: true }. Proved like
 * timetable changes, with a one-time op tied to the organiser secret.
 */
export function saveClub(entries, secret) {
  const op = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const body = { [`booking/adminOps/cfg/${op}`]: secret };
  for (const [path, value] of Object.entries(entries)) body[`club/${path}`] = { ...value, op };
  return request('PATCH', '', body);
}

/** Organiser: open check-in for a session with a code, shown at the door as a QR code. */
export function openCheckin(sessionKey, code, secret) {
  return request('PATCH', '', {
    [`booking/adminOps/ck/${sessionKey}/${code}`]: secret,
    [`booking/checkin/${sessionKey}/${code}`]: true,
  });
}

/** Member: check yourself in, proving the booking with its key and being there with the code. */
export function checkIn(sessionKey, id, key, code) {
  return request('PATCH', '', {
    [`booking/attendance/${sessionKey}/${id}`]: { present: true, how: 'self', at: SERVER_TIME },
    [`booking/attendProofs/${sessionKey}/${id}`]: { key, code },
  });
}

/**
 * Organiser: mark someone present or not (`id` is a booking id), or add or
 * remove a walk-in (`extra` = { walkIn: true, name, enc? }).
 */
export function setAttendance(sessionKey, id, present, secret, extra = {}) {
  const op = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return request('PATCH', '', {
    [`booking/adminOps/att/${op}`]: secret,
    [`booking/attendance/${sessionKey}/${id}`]: { ...extra, present, how: 'org', at: SERVER_TIME, op },
  });
}

/** One-off read of a path from a key onwards (for reports). */
export function fetchFrom(path, startAt) {
  return request('GET', path, undefined, keyQuery(startAt));
}

const keyQuery = (startAt) =>
  startAt ? `?orderBy=${encodeURIComponent('"$key"')}&startAt=${encodeURIComponent(JSON.stringify(startAt))}` : '';

/**
 * Live view of a path (optionally from a key onwards). Calls onChange(tree)
 * on every update and onStatus('live' | 'offline'). Returns a close function.
 */
export function watch(path, { startAt, onChange, onStatus }) {
  let tree = {};
  const es = new EventSource(`${serverUrl()}/${path}.json${keyQuery(startAt)}`);
  const handle = (kind) => (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!msg) return;
    tree = applyEvent(tree, kind, msg.path, msg.data);
    onStatus?.('live');
    onChange(tree);
  };
  es.addEventListener('put', handle('put'));
  es.addEventListener('patch', handle('patch'));
  es.addEventListener('open', () => onStatus?.('live'));
  es.addEventListener('error', () => onStatus?.('offline'));
  return () => es.close();
}
