import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database, leaves, parseUrl } from '../server/db.js';

const NOW = 1_800_000_000_000;
const ADMIN = 'a'.repeat(64);
const S = '2026-10-21_wed-clfc';
const SV = { '.sv': 'timestamp' };
const KEY = 'k'.repeat(32);

/** A database with bookings set up by an organiser. */
function club() {
  const db = new Database();
  const ok = (r) => assert.equal(r.status, 200, JSON.stringify(r.body));
  ok(
    db.write(
      'PATCH',
      [],
      {
        'booking/publicKey': 'pk',
        'booking/privateKey': { salt: 's', iv: 'i', data: 'd' },
        [`booking/admin/${ADMIN}`]: true,
      },
      NOW,
    ),
  );
  return { db, ok, no: (r) => assert.equal(r.status, 401, JSON.stringify(r.body)) };
}
const book = (db, id = 'b1', key = KEY) =>
  db.write(
    'PATCH',
    [],
    {
      [`booking/sessions/${S}/${id}`]: { name: 'Ann Lee', enc: 'x', createdAt: SV },
      [`booking/keys/${S}/${id}/${key}`]: true,
    },
    NOW,
  );

test('reads: only the public parts', () => {
  const { db } = club();
  assert.equal(db.read([]).status, 401);
  assert.equal(db.read(['booking']).status, 401);
  assert.equal(db.read(['booking', 'admin']).status, 401);
  assert.equal(db.read(['booking', 'keys']).status, 401);
  assert.equal(db.read(['owners']).status, 401);
  assert.equal(db.read(['poules']).status, 401);
  assert.equal(db.read(['poules', 'K7QM4X']).status, 200);
  assert.equal(db.read(['booking', 'sessions']).status, 200);
  assert.equal(db.read(['club']).status, 200);
});

test('bookings: made with a server timestamp, cancelled only with their key', () => {
  const { db, ok, no } = club();
  ok(book(db));
  assert.equal(db.get(['booking', 'sessions', S, 'b1', 'createdAt']), NOW);
  no(book(db)); // can't overwrite
  // A client-side timestamp, extra fields, bad session keys are refused.
  no(db.write('PUT', ['booking', 'sessions', S, 'b2'], { name: 'X Y', enc: 'x', createdAt: NOW - 1 }, NOW));
  no(db.write('PUT', ['booking', 'sessions', S, 'b2'], { name: 'X Y', enc: 'x', createdAt: SV, extra: 1 }, NOW));
  no(db.write('PUT', ['booking', 'sessions', 'nope', 'b2'], { name: 'X Y', enc: 'x', createdAt: SV }, NOW));
  // Deleting someone else's booking: plain, with a wrong key, or with a wrong organiser secret.
  no(db.write('DELETE', ['booking', 'sessions', S, 'b1'], null, NOW));
  no(
    db.write('PATCH', [], { [`booking/sessions/${S}/b1`]: null, [`booking/cancels/${S}/b1`]: 'wrong'.repeat(5) }, NOW),
  );
  no(
    db.write('PATCH', [], { [`booking/sessions/${S}/b1`]: null, [`booking/adminOps/rm/${S}/b1`]: 'f'.repeat(64) }, NOW),
  );
  ok(db.write('PATCH', [], { [`booking/sessions/${S}/b1`]: null, [`booking/cancels/${S}/b1`]: KEY }, NOW));
  assert.equal(db.get(['booking', 'sessions', S]), null);
});

test('a refused write changes nothing (all or nothing)', () => {
  const { db, no } = club();
  no(
    db.write(
      'PATCH',
      [],
      {
        [`booking/sessions/${S}/b1`]: { name: 'Ann Lee', enc: 'x', createdAt: SV },
        [`booking/keys/${S}/b1/${KEY}`]: true,
        'booking/admin/zzz': true, // not allowed
      },
      NOW,
    ),
  );
  assert.equal(db.get(['booking', 'sessions']), null);
});

test('organiser setup happens once; secrets can’t be replaced', () => {
  const { db, no } = club();
  no(db.write('PUT', ['booking', 'admin', 'b'.repeat(64)], true, NOW));
  no(db.write('PUT', ['booking', 'publicKey'], 'mine', NOW));
  no(db.write('PUT', ['booking', 'privateKey'], { salt: 1, iv: 1, data: 1 }, NOW));
});

test('timetable changes need a fresh op proved with the organiser secret', () => {
  const { db, ok, no } = club();
  const entry = { title: 'Gym', start: '10:00', end: '11:00', day: 2 };
  no(db.write('PUT', ['booking', 'config', 'weekly', 'w-1'], { ...entry, op: 'o1' }, NOW));
  no(
    db.write(
      'PATCH',
      [],
      { 'booking/adminOps/cfg/o1': 'f'.repeat(64), 'booking/config/weekly/w-1': { ...entry, op: 'o1' } },
      NOW,
    ),
  );
  ok(
    db.write(
      'PATCH',
      [],
      { 'booking/adminOps/cfg/o1': ADMIN, 'booking/config/weekly/w-1': { ...entry, op: 'o1' } },
      NOW,
    ),
  );
  // Replaying the used op without the secret is refused.
  no(db.write('PUT', ['booking', 'config', 'weekly', 'w-1'], { ...entry, title: 'Hacked', op: 'o1' }, NOW));
  // Bad fields are refused even with the secret.
  no(
    db.write(
      'PATCH',
      [],
      { 'booking/adminOps/cfg/o2': ADMIN, 'booking/config/weekly/w-1': { ...entry, start: '25:00', op: 'o2' } },
      NOW,
    ),
  );
});

test('check-in: the member’s booking key plus the code from the door', () => {
  const { db, ok, no } = club();
  ok(book(db));
  const checkIn = (key, code) =>
    db.write(
      'PATCH',
      [],
      {
        [`booking/attendance/${S}/b1`]: { present: true, how: 'self', at: SV },
        [`booking/attendProofs/${S}/b1`]: { key, code },
      },
      NOW,
    );
  no(checkIn(KEY, 'ABCD2345')); // no code opened yet
  no(
    db.write(
      'PATCH',
      [],
      { [`booking/adminOps/ck/${S}/ABCD2345`]: 'f'.repeat(64), [`booking/checkin/${S}/ABCD2345`]: true },
      NOW,
    ),
  );
  ok(
    db.write(
      'PATCH',
      [],
      { [`booking/adminOps/ck/${S}/ABCD2345`]: ADMIN, [`booking/checkin/${S}/ABCD2345`]: true },
      NOW,
    ),
  );
  no(checkIn('x'.repeat(32), 'ABCD2345')); // someone else's booking
  no(checkIn(KEY, 'ZZZZZZZZ')); // wrong code
  ok(checkIn(KEY, 'ABCD2345'));
  no(checkIn(KEY, 'ABCD2345')); // can't overwrite
  // The organiser marks people with a one-time op.
  const mark = (op, secret) =>
    db.write(
      'PATCH',
      [],
      {
        [`booking/adminOps/att/${op}`]: secret,
        [`booking/attendance/${S}/b1`]: { present: false, how: 'org', at: SV, op },
      },
      NOW,
    );
  no(mark('a1', 'f'.repeat(64)));
  ok(mark('a1', ADMIN));
  no(db.write('PUT', ['booking', 'attendance', S, 'b1'], { present: true, how: 'org', at: SV, op: 'a1' }, NOW)); // replay
});

test('club page: organiser only, https links, JPEG photos', () => {
  const { db, ok, no } = club();
  no(db.write('PUT', ['club', 'about'], { instagram: 'https://x.example', op: 'o1' }, NOW));
  ok(
    db.write(
      'PATCH',
      [],
      { 'booking/adminOps/cfg/o1': ADMIN, 'club/about': { instagram: 'https://x.example', op: 'o1' } },
      NOW,
    ),
  );
  no(
    db.write(
      'PATCH',
      [],
      { 'booking/adminOps/cfg/o2': ADMIN, 'club/about': { instagram: 'javascript:alert(1)', op: 'o2' } },
      NOW,
    ),
  );
  no(
    db.write(
      'PATCH',
      [],
      { 'booking/adminOps/cfg/o5': ADMIN, 'club/about': { feedback: 'http://forms.example', op: 'o5' } },
      NOW,
    ),
  );
  no(
    db.write(
      'PATCH',
      [],
      { 'booking/adminOps/cfg/o3': ADMIN, 'club/photos/p1': { src: 'data:image/svg+xml,<svg/>', op: 'o3' } },
      NOW,
    ),
  );
  ok(
    db.write(
      'PATCH',
      [],
      { 'booking/adminOps/cfg/o4': ADMIN, 'club/photos/p1': { src: 'data:image/jpeg;base64,AAAA', op: 'o4' } },
      NOW,
    ),
  );
});

test('shared poules: created once with an owner key, deleted only by the owner', () => {
  const db = new Database();
  const meta = { id: 'p', name: 'P', fencers: [{ id: 'a' }], bouts: [{ id: 'b' }] };
  const owner = 'o'.repeat(24);
  assert.equal(
    db.write('PATCH', [], { 'poules/K7QM4X/meta': meta, [`owners/K7QM4X/${owner}`]: true }, NOW).status,
    200,
  );
  assert.equal(db.write('PUT', ['poules', 'K7QM4X', 'meta'], meta, NOW).status, 401, 'meta is written once');
  assert.deepEqual(db.get(['poules', 'K7QM4X', 'meta', 'fencers']), [{ id: 'a' }], 'arrays stay arrays');
  const r = { scoreL: 5, scoreR: 2, winnerId: 'a' };
  assert.equal(db.write('PUT', ['poules', 'K7QM4X', 'results', 'b'], r, NOW).status, 200);
  assert.equal(db.write('PUT', ['poules', 'K7QM4X', 'results', 'b'], { ...r, scoreL: 500 }, NOW).status, 401);
  assert.equal(db.write('PUT', ['poules', 'K7QM4X', 'other'], {}, NOW).status, 401);
  assert.equal(db.write('PATCH', [], { 'poules/K7QM4X': null, 'deletions/K7QM4X': 'wrong' }, NOW).status, 401);
  assert.equal(db.write('PATCH', [], { 'poules/K7QM4X': null, 'deletions/K7QM4X': owner }, NOW).status, 200);
  assert.equal(db.get(['poules']), null);
});

test('live updates: puts, multi-path patches, and nothing for others’ paths', () => {
  const { db, ok } = club();
  const events = [];
  const stop = db.subscribe(['booking', 'sessions'], '2026-10-01', (e, d) => events.push([e, d]));
  ok(book(db));
  ok(db.write('PUT', ['poules', 'K7QM4X', 'meta'], { id: 'p', name: 'P', fencers: [1], bouts: [1] }, NOW)); // elsewhere
  stop();
  ok(book(db, 'b2', 'z'.repeat(32)));
  assert.equal(events[0][0], 'put');
  assert.deepEqual(Object.keys(events[1][1].data), [`${S}/b1`]);
  assert.equal(events.length, 2);
});

test('import: a whole export, only into an empty database', () => {
  const db = new Database();
  assert.equal(db.importAll({ hacked: true }).status, 400);
  assert.equal(db.importAll({ booking: { publicKey: 'pk' } }).status, 200);
  assert.equal(db.get(['booking', 'publicKey']), 'pk');
  assert.equal(db.importAll({ booking: { publicKey: 'other' } }).status, 409);
});

test('storage rows and URLs', () => {
  assert.deepEqual(leaves({ a: { b: 1, c: [1, 2] }, d: null }), [
    [['a', 'b'], 1],
    [
      ['a', 'c'],
      [1, 2],
    ],
  ]);
  assert.deepEqual(parseUrl('/booking/sessions.json', new URLSearchParams('startAt=%222026%22')), {
    parts: ['booking', 'sessions'],
    startAt: '2026',
  });
  assert.equal(parseUrl('/nope', new URLSearchParams()), null);
  assert.deepEqual(parseUrl('/.import', new URLSearchParams()), { special: 'import' });
});
