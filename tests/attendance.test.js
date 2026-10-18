import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkinOpen,
  CHECKIN_EARLY_MS,
  newCheckinCode,
  formatCheckinCode,
  normalizeCheckinCode,
  parseCheckinHash,
  attendanceOf,
  attendanceReport,
  recentSessions,
  upcomingSessions,
  zonedTime,
  registerCsv,
} from '../app/book/core.js';

const book = (n, prefix = 'b') =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`${prefix}${i}`, { name: `Member ${prefix}${i}`, enc: 'x', createdAt: i }]),
  );
const here = (at = 1) => ({ present: true, how: 'org', at });

test('check-in opens an hour before the start and closes at the end', () => {
  const s = { startMs: zonedTime('2026-10-21', '19:00'), endMs: zonedTime('2026-10-21', '21:00') };
  assert.equal(checkinOpen(s, s.startMs - CHECKIN_EARLY_MS - 1), false);
  assert.equal(checkinOpen(s, s.startMs - CHECKIN_EARLY_MS), true);
  assert.equal(checkinOpen(s, s.endMs), true);
  assert.equal(checkinOpen(s, s.endMs + 1), false);
});

test('check-in codes: 8 unambiguous characters, typed or scanned', () => {
  const c = newCheckinCode();
  assert.match(c, /^[A-HJKMNP-Z2-9]{8}$/);
  assert.equal(formatCheckinCode('ABCD2345'), 'ABCD-2345');
  assert.equal(normalizeCheckinCode(' abcd-2345 '), 'ABCD2345');
  assert.equal(normalizeCheckinCode('ABCD 234'), null);
  assert.equal(normalizeCheckinCode('ABCD2340'), null, '0 is not used');
  assert.deepEqual(parseCheckinHash('#checkin/2026-10-21_wed-clfc/ABCD2345'), {
    session: '2026-10-21_wed-clfc',
    code: 'ABCD2345',
  });
  assert.equal(parseCheckinHash('#checkin/../ABCD2345'), null);
  assert.equal(parseCheckinHash('#organiser'), null);
});

test('a register: booked members ticked, walk-ins listed, un-ticking wins', () => {
  const reg = attendanceOf({
    b1: here(5),
    b2: { present: false, how: 'org', at: 9 }, // ticked then un-ticked
    w1: { present: true, how: 'org', at: 7, walkIn: true, name: '  Zoe  Walker ' },
    w0: { present: true, how: 'org', at: 6, walkIn: true, name: 'Yan' },
    w2: { present: false, how: 'org', at: 8, walkIn: true, name: 'Removed' },
  });
  assert.deepEqual([...reg.present], ['b1']);
  assert.deepEqual(
    reg.walkIns.map((w) => w.name),
    ['Yan', 'Zoe Walker'],
  );
  assert.equal(reg.taken, true);
  assert.equal(attendanceOf(null).taken, false);
});

test('report: no-shows only for people with a place, at sessions with a register', () => {
  const s1 = '2026-10-05_mon-clfc';
  const s2 = '2026-10-07_wed-clfc';
  const s3 = '2026-10-12_mon-clfc'; // no register taken
  const s4 = '2026-10-14_wed-clfc'; // cancelled
  const sessions = { [s1]: book(4), [s2]: book(3), [s3]: book(3), [s4]: book(2) };
  const attendance = {
    [s1]: { b0: here(), b1: here(), b3: here(), w9: { ...here(), walkIn: true, name: 'Member b2' } },
    [s2]: { b0: here() },
    [s4]: { b0: here() },
  };
  const closures = { [s4]: { c1: { closed: true, at: 1 } } };
  // s1 has 3 places: b0–b2 booked, b3 waitlisted (and came anyway)
  const r = attendanceReport({ sessions, attendance, closures, capacityOf: (k) => (k === s1 ? 3 : 30) });
  assert.equal(r.sessions, 2);
  assert.equal(r.places, 3 + 3);
  assert.equal(r.attended, 3 + 1 + 1); // s1: b0, b1, b3 + walk-in; s2: b0
  assert.equal(r.walkIns, 1);
  assert.equal(r.noShows, 1 + 2); // s1: b2; s2: b1, b2
  const by = Object.fromEntries(r.people.map((p) => [p.name, p]));
  assert.deepEqual(by['Member b0'], {
    key: 'member b0',
    name: 'Member b0',
    booked: 2,
    attended: 2,
    noShows: 0,
    walkIns: 0,
  });
  // b2 didn't show for s1's booking but walked in under the same name — counted as both
  assert.equal(by['Member b2'].noShows, 2);
  assert.equal(by['Member b2'].walkIns, 1);
  assert.equal(by['Member b3'].booked, 0, 'waitlisted');
  assert.equal(by['Member b3'].attended, 1);
  // most no-shows first
  assert.equal(r.people[0].name, 'Member b2');
  // date range
  assert.equal(attendanceReport({ sessions, attendance, closures, from: '2026-10-06' }).sessions, 1);
});

test('report: people can be matched by membership number instead of name', () => {
  const s1 = '2026-10-05_mon-clfc';
  const s2 = '2026-10-07_wed-clfc';
  const sessions = {
    [s1]: { a: { name: 'Sam Lee', enc: 'N1', createdAt: 1 } },
    [s2]: { b: { name: 'Samuel Lee', enc: 'N1', createdAt: 1 } },
  };
  const attendance = { [s1]: { a: here() }, [s2]: { x: here() } };
  const r = attendanceReport({ sessions, attendance, personOf: (b) => ({ key: b.enc, name: b.name }) });
  assert.equal(r.people.length, 1);
  assert.deepEqual([r.people[0].attended, r.people[0].noShows], [1, 1]);
});

test('recent sessions: the last week’s finished sessions, newest first', () => {
  const now = Date.parse('2026-10-22T12:00:00Z'); // Thursday, 1 pm UK
  const recent = recentSessions(now, { days: 7 });
  assert.ok(recent.length > 0);
  assert.ok(recent.every((s) => s.endMs <= now));
  assert.equal(recent[0].key, '2026-10-21_wed-clfc');
  assert.ok(recent.every((s, i) => i === 0 || recent[i - 1].startMs >= s.startMs));
  assert.ok(recent.at(-1).date >= '2026-10-15');
  // and none of them are still in the upcoming list
  const up = new Set(upcomingSessions(now).map((s) => s.key));
  assert.ok(recent.every((s) => !up.has(s.key)));
});

test('the register CSV says who attended', () => {
  const session = { date: '2026-10-21', start: '19:00', end: '21:00', title: 'Central London FC', offsite: true };
  const csv = registerCsv([
    { session, status: 'booked', position: 1, name: 'Ann', member: 'U1', bookedAt: 1000, attended: 'yes' },
    { session, status: 'walk-in', position: 1, name: 'Wes', member: '', bookedAt: null, attended: 'yes' },
  ]);
  assert.match(csv.split('\r\n')[0], /,Attended$/);
  assert.match(csv, /Ann,U1,1970-01-01T00:00:01.000Z,yes/);
  assert.match(csv, /walk-in,1,Wes,,,yes/);
});
