// Moving Piste to a new address (e.g. from GitHub Pages to your own domain).
// Phones keep data per address, so when HOME_URL is set the old address
// sends people on, carrying this phone's data in the link's #fragment (which
// never reaches a server): poules, team matches, the roster and settings,
// plus training bookings (whose secret keys are needed to cancel and check in).

import { HOME_URL, OLD_HOSTS } from './config.js';

const LOCAL_KEYS = ['piste:myBookings', 'piste:me', 'piste:myLessons', 'piste:checkinCodes'];
const MOVE = '#move=';

const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
};

/** The address Piste lives at, without a trailing slash ('' = wherever it's served). */
export function homeUrl() {
  return String(read('piste:homeUrl') || HOME_URL || '').replace(/\/+$/, '');
}

const oldHosts = () => {
  const extra = read('piste:oldHosts'); // tests: a local stand-in for the old address
  return [...OLD_HOSTS, ...(extra ? extra.split(',') : [])];
};

/** True on an old address that should send people to HOME_URL. */
export function movedAway() {
  const home = homeUrl();
  if (!home || !oldHosts().includes(location.host)) return false;
  try {
    return new URL(home).origin !== location.origin;
  } catch {
    return false;
  }
}

/** Is the new address up and serving this app? (It answers app/piste.json.) */
export async function homeReady() {
  try {
    const res = await fetch(`${homeUrl()}/piste.json`, { cache: 'no-store', signal: AbortSignal.timeout?.(5000) });
    return (await res.json())?.app === 'piste';
  } catch {
    return false;
  }
}

/** Booking data kept on this phone (only what's there). */
export function localData() {
  const out = {};
  for (const k of LOCAL_KEYS) {
    const v = read(k);
    if (v != null && v !== '[]' && v !== '{}') out[k] = v;
  }
  return out;
}

const b64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** JSON → gzip → base64url (falls back to plain base64url without CompressionStream). */
export async function pack(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') return `j${b64url(raw)}`;
  return `z${b64url(await pipe(raw, new CompressionStream('gzip')))}`;
}

export async function unpack(s) {
  const bytes = unb64url(s.slice(1));
  const raw = s[0] === 'z' ? await pipe(bytes, new DecompressionStream('gzip')) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

/** Go to the new address, keeping the current #link (e.g. #join/CODE, #checkin/…). */
export function goHome(page = 'app') {
  location.replace(`${homeUrl()}/${page === 'book' ? 'book/' : ''}${location.hash}`);
}

/** Go to the new address taking this phone's data along. `backup` = the app's exportBackup(). */
export async function moveHome({ page = 'app', backup = null } = {}) {
  const payload = { v: 1, page, hash: location.hash, local: localData(), backup };
  location.replace(`${homeUrl()}/${MOVE}${await pack(payload)}`);
}

/**
 * On the new address: take in data handed over by the old one. Booking data
 * is merged into this phone's; returns the payload (the caller imports
 * `backup`) or null if this isn't a move.
 */
export async function receiveMove() {
  if (!location.hash.startsWith(MOVE)) return null;
  let payload;
  try {
    payload = await unpack(location.hash.slice(MOVE.length));
  } catch {
    history.replaceState(null, '', location.pathname);
    return null;
  }
  const parse = (v, fallback) => {
    try {
      return JSON.parse(v) ?? fallback;
    } catch {
      return fallback;
    }
  };
  for (const [k, v] of Object.entries(payload.local ?? {})) {
    if (!LOCAL_KEYS.includes(k) || typeof v !== 'string') continue;
    const mine = parse(read(k), null);
    const theirs = parse(v, null);
    if (Array.isArray(theirs)) {
      const list = Array.isArray(mine) ? mine : [];
      const ids = new Set(list.map((x) => x?.id));
      write(k, JSON.stringify([...list, ...theirs.filter((x) => x && !ids.has(x.id))]));
    } else if (theirs && typeof theirs === 'object') {
      write(k, JSON.stringify({ ...theirs, ...(mine && typeof mine === 'object' ? mine : {}) }));
    }
  }
  history.replaceState(null, '', location.pathname + (payload.page === 'book' ? '' : payload.hash || ''));
  return payload;
}
