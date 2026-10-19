import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  upcomingSessions,
  zonedTime,
  zonedDate,
  tzOffset,
  roster,
  placeOf,
  closureOf,
  validateBooking,
  alreadyBooked,
  applyEvent,
  sessionKey,
  registerCsv,
  newId,
  timetable,
  validateSession,
  newSessionId,
  venueOf,
} from '../app/book/core.js';
import { DEFAULT_WEEKLY, CAPACITY } from '../app/book/schedule.js';
import { createOrganiserKeys, unlockOrganiser, encryptFor, decryptWith } from '../app/book/crypto.js';

test('the timetable matches the club poster', () => {
  const byDay = (d) =>
    DEFAULT_WEEKLY.filter((s) => s.day === d).map(
      (s) => `${s.title.split(',')[0]}${s.offsite ? '*' : ''} ${s.start}-${s.end}`,
    );
  assert.deepEqual(byDay(1), ['Central London FC* 19:00-21:00']);
  assert.deepEqual(byDay(3), ['Mandela Studio 11:30-13:30', 'Central London FC* 19:00-21:00']);
  assert.deepEqual(byDay(4), ['Mandela Studio 15:00-17:00']);
  assert.deepEqual(byDay(6), ['Mandela Studio 10:00-13:00']);
  assert.equal(CAPACITY, 30);
});

test('UK times: summer (BST) and winter (GMT)', () => {
  assert.equal(new Date(zonedTime('2026-07-06', '19:00')).toISOString(), '2026-07-06T18:00:00.000Z');
  assert.equal(new Date(zonedTime('2026-12-07', '19:00')).toISOString(), '2026-12-07T19:00:00.000Z');
  // Across the clocks going back (25 Oct 2026).
  assert.equal(new Date(zonedTime('2026-10-26', '19:00')).toISOString(), '2026-10-26T19:00:00.000Z');
  assert.equal(tzOffset(Date.parse('2026-07-01T12:00:00Z')), 60);
  assert.equal(zonedDate(Date.parse('2026-07-01T23:30:00Z')), '2026-07-02');
});

test('upcoming sessions: two weeks, in order, finished ones dropped', () => {
  // Wed 21 Oct 2026, 12:00 UK time (BST): the 11:30 session is under way, so still listed.
  const now = zonedTime('2026-10-21', '12:00');
  const s = upcomingSessions(now);
  assert.equal(s[0].key, '2026-10-21_wed-mandela');
  assert.equal(s[1].key, '2026-10-21_wed-clfc');
  assert.ok(s.every((x, i) => i === 0 || s[i - 1].startMs <= x.startMs));
  assert.ok(s.every((x) => x.endMs > now));
  // Two weeks from Wed: Wed(2) Thu Sat | Mon Wed(2) Thu Sat | Mon Wed(2 → only up to Tue 3 Nov).
  assert.deepEqual(
    s.map((x) => x.week),
    [0, 0, 0, 0, 1, 1, 1, 1, 1, 2],
  );
  const later = upcomingSessions(zonedTime('2026-10-21', '13:31'));
  assert.equal(later[0].key, '2026-10-21_wed-clfc', 'finished session dropped');
});

test('first 30 are booked, the rest waitlisted, by booking time', () => {
  const bookings = {};
  for (let i = 0; i < 33; i++) bookings[`b${String(i).padStart(2, '0')}`] = { name: `F${i}`, createdAt: 1000 + i };
  const r = roster(bookings);
  assert.equal(r.booked.length, 30);
  assert.deepEqual(
    r.waitlist.map((b) => b.name),
    ['F30', 'F31', 'F32'],
  );
  assert.deepEqual(placeOf(r, 'b31'), { status: 'waitlist', position: 2 });
  assert.deepEqual(placeOf(r, 'b00'), { status: 'booked', position: 1 });
  // Someone cancels: the first on the waitlist moves up.
  delete bookings.b05;
  assert.deepEqual(placeOf(roster(bookings), 'b30'), { status: 'booked', position: 30 });
});

test('closures: the latest entry wins', () => {
  assert.equal(closureOf(null), null);
  assert.deepEqual(closureOf({ a: { closed: true, reason: 'Venue closed', at: 1 } }), {
    closed: true,
    reason: 'Venue closed',
  });
  assert.equal(closureOf({ a: { closed: true, at: 1 }, b: { closed: false, at: 2 } }), null);
});

test('booking details are checked', () => {
  assert.equal(validateBooking({ name: 'Ada Lovelace', member: 'UCL12345' }), null);
  assert.match(validateBooking({ name: 'A', member: '123' }), /your name/);
  assert.match(validateBooking({ name: 'Ada', member: '' }), /enter your membership number/);
  assert.match(validateBooking({ name: 'Ada', member: '12' }), /membership/);
  assert.match(validateBooking({ name: 'Ada', member: 'abc 123' }), /membership/);
  const r = roster({ x: { name: 'Ada  Lovelace', createdAt: 1 } });
  assert.equal(alreadyBooked(r, 'ada lovelace'), true);
  assert.equal(alreadyBooked(r, 'Ada L'), false);
});

test('live updates are applied to the local copy', () => {
  let t = applyEvent({}, 'put', '/', { s1: { a: { name: 'A' } } });
  t = applyEvent(t, 'put', '/s1/b', { name: 'B' });
  t = applyEvent(t, 'put', '/s2', { c: { name: 'C' } });
  assert.deepEqual(Object.keys(t.s1), ['a', 'b']);
  t = applyEvent(t, 'put', '/s1/a', null);
  assert.deepEqual(Object.keys(t.s1), ['b']);
  t = applyEvent(t, 'patch', '/s2', { d: { name: 'D' } });
  assert.deepEqual(Object.keys(t.s2).sort(), ['c', 'd']);
});

test('live updates: multi-path patches from the real server', () => {
  // What Firebase streams to a watcher of booking/sessions after a root PATCH.
  let t = applyEvent({}, 'put', '/', null);
  assert.deepEqual(t, {});
  t = applyEvent(t, 'patch', '/', { '2026-10-19_mon-clfc': { b1: { name: 'M 1' } } });
  t = applyEvent(t, 'patch', '/', { '2026-10-19_mon-clfc/b2': { name: 'M 2' } });
  t = applyEvent(t, 'patch', '/', {
    '2026-10-19_mon-clfc/b3': { name: 'M 3' },
    '2026-10-21_wed-clfc/b9': { name: 'X' },
  });
  assert.deepEqual(Object.keys(t['2026-10-19_mon-clfc']).sort(), ['b1', 'b2', 'b3']);
  assert.equal(t['2026-10-21_wed-clfc'].b9.name, 'X');
  // a cancellation: the booking set to null; the emptied session disappears
  t = applyEvent(t, 'patch', '/', { '2026-10-21_wed-clfc/b9': null });
  assert.equal(t['2026-10-21_wed-clfc'], undefined);
  // a patch replaces each key it names (not a deep merge)
  t = applyEvent(t, 'patch', '/2026-10-19_mon-clfc', { b1: { name: 'M 1 renamed' } });
  assert.deepEqual(t['2026-10-19_mon-clfc'].b1, { name: 'M 1 renamed' });
});

test('ids and CSV', () => {
  assert.match(newId(), /^b[0-9a-z]{16,}$/);
  assert.equal(sessionKey('2026-10-21', 'wed-clfc'), '2026-10-21_wed-clfc');
  const session = { date: '2026-10-21', start: '19:00', end: '21:00', title: 'Central London FC' };
  const csv = registerCsv([{ session, status: 'booked', position: 1, name: 'Ada, L', member: 'UCL1', bookedAt: 1000 }]);
  assert.match(csv, /2026-10-21,19:00,21:00,Central London FC,booked,1,"Ada, L",UCL1,1970/);
});

test('membership numbers: only the organiser’s passphrase decrypts them', async () => {
  const keys = await createOrganiserKeys('correct horse battery');
  const blob = JSON.parse(JSON.stringify(keys.privateKey)); // as stored on the server
  const cipher = await encryptFor(keys.publicKey, 'UCL12345');
  assert.ok(!cipher.includes('UCL12345'));
  const org = await unlockOrganiser('correct horse battery', blob);
  assert.equal(org.secret, keys.secret, 'same admin secret on any device');
  assert.equal(await decryptWith(org.privateKey, cipher), 'UCL12345');
  await assert.rejects(unlockOrganiser('wrong passphrase', blob), /Wrong passphrase/);
});

/* ---------- organiser-editable timetable ---------- */

const NOW = zonedTime('2026-10-21', '12:00'); // Wed 21 Oct 2026
const cfg = (x) => ({
  meta: { main: { seeded: true } },
  weekly: Object.fromEntries(DEFAULT_WEEKLY.map(({ id, ...w }) => [id, w])),
  ...x,
});

test('until an organiser edits it, the default timetable is used', () => {
  assert.equal(timetable(null).seeded, false);
  assert.equal(timetable(null).weekly.length, 5);
  const s = upcomingSessions(NOW);
  assert.ok(s.every((x) => x.capacity === CAPACITY && x.kind === 'weekly'));
  assert.equal(s.find((x) => x.key === '2026-10-21_wed-clfc').offsite, true);
  assert.equal(venueOf(s[1]).note, 'Offsite · bring your own kit');
});

test('weekly sessions can be edited, added and deleted', () => {
  const c = cfg({});
  c.weekly['wed-clfc'] = { ...c.weekly['wed-clfc'], start: '18:30', capacity: 24 };
  c.weekly['thu-mandela'] = { deleted: true };
  c.weekly['w-fri'] = { day: 5, title: 'Bloomsbury Fitness', start: '17:00', end: '18:30', capacity: 12 };
  const s = upcomingSessions(NOW, { config: c });
  const wed = s.find((x) => x.key === '2026-10-21_wed-clfc');
  assert.deepEqual([wed.start, wed.capacity], ['18:30', 24]);
  assert.ok(!s.some((x) => x.sourceId === 'thu-mandela'), 'deleted weekly session gone');
  assert.ok(s.some((x) => x.key === '2026-10-23_w-fri' && x.title === 'Bloomsbury Fitness'));
  // Deleting every weekly session leaves none (doesn't fall back to defaults).
  assert.equal(upcomingSessions(NOW, { config: { meta: { main: { seeded: true } }, weekly: {} } }).length, 0);
});

test('one-off sessions appear on their date, up to 12 weeks ahead', () => {
  const c = cfg({
    events: {
      'e-open': {
        date: '2026-11-14',
        title: 'Open session',
        start: '14:00',
        end: '17:00',
        capacity: 40,
        note: 'Guests welcome',
      },
      'e-far': { date: '2027-03-01', title: 'Too far', start: '10:00', end: '11:00', capacity: 5 },
      'e-gone': { deleted: true },
    },
  });
  const s = upcomingSessions(NOW, { config: c });
  const ev = s.find((x) => x.sourceId === 'e-open');
  assert.equal(ev.key, '2026-11-14_e-open');
  assert.equal(ev.kind, 'event');
  assert.equal(venueOf(ev).badge, 'One-off');
  assert.equal(venueOf(ev).note, 'Guests welcome');
  assert.ok(!s.some((x) => x.sourceId === 'e-far' || x.sourceId === 'e-gone'));
});

test('one date can be changed without touching the others', () => {
  const c = cfg({ overrides: { '2026-10-28_wed-mandela': { start: '12:00', title: 'TeamUCL Gym Hall 2', op: 'x' } } });
  const s = upcomingSessions(NOW, { config: c });
  const changed = s.find((x) => x.key === '2026-10-28_wed-mandela');
  const same = s.find((x) => x.key === '2026-10-21_wed-mandela');
  assert.deepEqual(
    [changed.start, changed.end, changed.title, changed.changed],
    ['12:00', '13:30', 'TeamUCL Gym Hall 2', true],
  );
  assert.deepEqual([same.start, same.changed], ['11:30', false]);
  c.overrides['2026-10-28_wed-mandela'] = { cleared: true, op: 'y' };
  assert.equal(upcomingSessions(NOW, { config: c }).find((x) => x.key === '2026-10-28_wed-mandela').start, '11:30');
});

test('session editor checks', () => {
  const ok = { title: 'Mandela Studio', start: '10:00', end: '12:00', capacity: 30, day: 3 };
  assert.equal(validateSession(ok, { kind: 'weekly' }), null);
  assert.match(validateSession({ ...ok, end: '09:00' }, { kind: 'weekly' }), /end after/);
  assert.match(validateSession({ ...ok, capacity: 0 }, { kind: 'weekly' }), /Places/);
  assert.match(validateSession({ ...ok, title: 'x' }, { kind: 'weekly' }), /venue/);
  assert.match(validateSession({ ...ok, date: '2026-10-01' }, { kind: 'event', today: '2026-10-21' }), /passed/);
  assert.match(newSessionId('weekly'), /^w-[0-9a-z]{8}$/);
  assert.match(newSessionId('event'), /^e-[0-9a-z]{8}$/);
});

test('coach lesson lists per session, changeable for one date', () => {
  const c = cfg({});
  c.weekly['wed-clfc'] = {
    ...c.weekly['wed-clfc'],
    lessons: { l1: { coach: 'Marc', slots: 6 }, l2: { coach: 'Sofia', slots: 4 } },
  };
  c.overrides = { '2026-10-28_wed-clfc': { lessons: { l1: { coach: 'Marc', slots: 3 } }, op: 'x' } };
  const s = upcomingSessions(NOW, { config: c });
  const a = s.find((x) => x.key === '2026-10-21_wed-clfc');
  const b = s.find((x) => x.key === '2026-10-28_wed-clfc');
  assert.deepEqual(
    a.lessons.map((l) => `${l.coach}:${l.slots}`),
    ['Marc:6', 'Sofia:4'],
  );
  assert.deepEqual(
    b.lessons.map((l) => `${l.coach}:${l.slots}`),
    ['Marc:3'],
  );
  assert.deepEqual(s.find((x) => x.key === '2026-10-21_wed-mandela').lessons, []);
  // Sign-ups beyond the coach's slots are reserves (same ordering as bookings).
  const r = roster({ x: { name: 'A', createdAt: 1 }, y: { name: 'B', createdAt: 2 } }, 1);
  assert.deepEqual([r.booked.map((x) => x.name), r.waitlist.map((x) => x.name)], [['A'], ['B']]);
  assert.match(
    validateSession(
      { title: 'Gym', start: '10:00', end: '11:00', capacity: 5, day: 1, lessons: [{ coach: 'M', slots: 2 }] },
      { kind: 'weekly' },
    ),
    /coach/,
  );
});
