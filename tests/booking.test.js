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
} from '../app/book/core.js';
import { SCHEDULE, CAPACITY } from '../app/book/schedule.js';
import { createOrganiserKeys, unlockOrganiser, encryptFor, decryptWith } from '../app/book/crypto.js';

test('the timetable matches the club poster', () => {
  const byDay = (d) => SCHEDULE.filter((s) => s.day === d).map((s) => `${s.venue} ${s.start}-${s.end}`);
  assert.deepEqual(byDay(1), ['clfc 19:00-21:00']);
  assert.deepEqual(byDay(3), ['mandela 11:30-13:30', 'clfc 19:00-21:00']);
  assert.deepEqual(byDay(4), ['mandela 15:00-17:00']);
  assert.deepEqual(byDay(6), ['mandela 10:00-13:00']);
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
  assert.match(validateBooking({ name: 'A', member: '123' }), /full name/);
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

test('ids and CSV', () => {
  assert.match(newId(), /^b[0-9a-z]{16,}$/);
  assert.equal(sessionKey('2026-10-21', 'wed-clfc'), '2026-10-21_wed-clfc');
  const session = { date: '2026-10-21', start: '19:00', end: '21:00', venue: 'clfc' };
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
