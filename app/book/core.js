// Booking logic: the timetable expanded into dated sessions, who is booked
// and who is waitlisted, input checks, and applying live updates. Pure
// functions (no DOM, no network), unit-tested.

import { CAPACITY, SCHEDULE, VENUES, WEEKS_AHEAD, CLUB } from './schedule.js';

const DAY = 86_400_000;

/** Minutes ahead of UTC for `tz` at instant `ts`. */
export function tzOffset(ts, tz = CLUB.timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ts));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(ts / 1000) * 1000) / 60000);
}

/** Epoch ms of a wall-clock date + time in `tz` ('2026-10-20', '19:00'). */
export function zonedTime(date, time, tz = CLUB.timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - tzOffset(guess, tz) * 60000;
  ts = guess - tzOffset(ts, tz) * 60000; // settle across a DST change
  return ts;
}

/** The calendar date ('YYYY-MM-DD') in `tz` at instant `ts`. */
export function zonedDate(ts, tz = CLUB.timeZone) {
  return new Date(ts + tzOffset(ts, tz) * 60000).toISOString().slice(0, 10);
}

const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

export const sessionKey = (date, id) => `${date}_${id}`;

/**
 * Sessions from today for `weeks` weeks that haven't finished yet.
 * Each: { key, date, id, day, venue, start, end, startMs, endMs, week }
 */
export function upcomingSessions(now = Date.now(), { weeks = WEEKS_AHEAD, schedule = SCHEDULE } = {}) {
  const today = zonedDate(now);
  const out = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(today, i);
    for (const s of schedule) {
      if (s.day !== weekday(date)) continue;
      const startMs = zonedTime(date, s.start);
      const endMs = zonedTime(date, s.end);
      if (endMs <= now) continue;
      out.push({ ...s, key: sessionKey(date, s.id), date, startMs, endMs, week: weekOf(today, date) });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** 0 = this week (Mon–Sun), 1 = next week, … */
function weekOf(today, date) {
  const monday = (d) => addDays(d, -((weekday(d) + 6) % 7));
  return Math.round((Date.parse(monday(date)) - Date.parse(monday(today))) / (7 * DAY));
}

/** Bookings for one session ({ id: { name, createdAt } }) split into booked and waitlist, in order. */
export function roster(bookings, capacity = CAPACITY) {
  const list = Object.entries(bookings ?? {})
    .filter(([, b]) => b && typeof b.name === 'string')
    .map(([id, b]) => ({ id, ...b }))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id));
  return { booked: list.slice(0, capacity), waitlist: list.slice(capacity), capacity };
}

/** Where a booking stands: { status: 'booked' | 'waitlist' | null, position } */
export function placeOf(r, bookingId) {
  const i = r.booked.findIndex((b) => b.id === bookingId);
  if (i >= 0) return { status: 'booked', position: i + 1 };
  const w = r.waitlist.findIndex((b) => b.id === bookingId);
  if (w >= 0) return { status: 'waitlist', position: w + 1 };
  return { status: null, position: 0 };
}

/** Latest closure entry for a session: { closed, reason } or null. */
export function closureOf(entries) {
  const list = Object.values(entries ?? {}).filter((e) => e && typeof e.closed === 'boolean');
  if (!list.length) return null;
  const last = list.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).at(-1);
  return last.closed ? { closed: true, reason: last.reason ?? '' } : null;
}

export function cleanName(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Check booking details. Returns an error message or null. */
export function validateBooking({ name, member }) {
  const n = cleanName(name);
  if (n.length < 2) return 'Please enter your full name';
  if (n.length > 60) return 'That name is too long';
  const m = String(member ?? '').trim();
  if (!/^[A-Za-z0-9-]{3,20}$/.test(m)) return 'Enter your membership or student number (letters and numbers only)';
  return null;
}

/** Is `name` already on this session (case-insensitive)? */
export function alreadyBooked(r, name) {
  const n = cleanName(name).toLowerCase();
  return [...r.booked, ...r.waitlist].some((b) => cleanName(b.name).toLowerCase() === n);
}

/** Apply a Firebase streaming event ({ path, data }) to a plain object tree. */
export function applyEvent(tree, kind, path, data) {
  const parts = String(path ?? '/')
    .split('/')
    .filter(Boolean);
  const root = structuredClone(tree ?? {});
  if (!parts.length) {
    if (kind === 'put') return data ?? {};
    return { ...root, ...(data ?? {}) };
  }
  let node = root;
  for (const p of parts.slice(0, -1)) {
    if (!node[p] || typeof node[p] !== 'object') node[p] = {};
    node = node[p];
  }
  const last = parts.at(-1);
  if (kind === 'patch') node[last] = { ...(node[last] ?? {}), ...(data ?? {}) };
  else if (data == null) delete node[last];
  else node[last] = data;
  return root;
}

/** A short, sortable, unguessable id for a new booking. */
export function newId(rand = Math.random) {
  let r = '';
  for (let i = 0; i < 10; i++) r += Math.floor(rand() * 36).toString(36);
  return `b${Date.now().toString(36)}${r}`;
}

export function venueOf(s) {
  return VENUES[s.venue] ?? { name: s.venue, short: s.venue, color: 'gray' };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV register. rows: [{ session, status, position, name, member, bookedAt }] */
export function registerCsv(rows) {
  const lines = [
    ['Date', 'Start', 'End', 'Venue', 'Status', '#', 'Name', 'Membership / student no.', 'Booked at'].join(','),
  ];
  for (const r of rows) {
    lines.push(
      [
        r.session.date,
        r.session.start,
        r.session.end,
        venueOf(r.session).name,
        r.status,
        r.position,
        r.name,
        r.member ?? '',
        r.bookedAt ? new Date(r.bookedAt).toISOString() : '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
