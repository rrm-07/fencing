// The club database: a small JSON tree with the Firebase Realtime Database
// REST API that the app already speaks, and the access rules from
// database.rules.json written out in JavaScript. Shared by the Cloudflare
// Durable Object (production, server/worker.js) and the local test server
// (scripts/mock-share-server.js), so what the tests exercise is what runs.
//
//   GET    /<path>.json[?orderBy="$key"&startAt="…"]   read (or stream with Accept: text/event-stream)
//   PUT    /<path>.json                                 set
//   PATCH  /<path>.json   { "a/b": …, "c": … }          several paths at once, all or nothing
//   DELETE /<path>.json
//   { ".sv": "timestamp" } in a write becomes the server time.

const CODE = /^[A-HJKMNP-Z2-9]{6}$/;
const SESSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[a-z0-9-]{1,40}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const TOP = ['poules', 'owners', 'deletions', 'booking', 'club'];
export const MAX_BODY = 2_000_000;

export const split = (p) => String(p).split('/').filter(Boolean);
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isBool = (v) => typeof v === 'boolean';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strMax = (v, n) => isStr(v) && v.length <= n;
const has = (v, keys) => isObj(v) && keys.every((k) => v[k] != null);
const startsWith = (a, b) => b.every((k, i) => a[i] === k);

function getIn(node, parts) {
  for (const k of parts) node = node && typeof node === 'object' ? node[k] : undefined;
  return node ?? null;
}

/** Drop empty objects (Firebase never keeps empty nodes). */
function prune(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') {
      prune(v);
      if (!Object.keys(v).length) delete node[k];
    } else if (v === null || v === undefined) delete node[k];
  }
  return node;
}

/** Replace { ".sv": "timestamp" } with the server time. */
export function serverValues(v, now) {
  if (Array.isArray(v)) return v.map((x) => serverValues(x, now));
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return now;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serverValues(x, now)]));
  }
  return v;
}

/** orderBy="$key"&startAt=… on an object. */
export function query(value, startAt) {
  if (startAt == null || !isObj(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k >= startAt));
}

/** Which paths can be read (database.rules.json `.read`). */
export function readable(p) {
  if (p[0] === 'poules') return p.length >= 2 && CODE.test(p[1]);
  if (p[0] === 'club') return true;
  if (p[0] === 'booking')
    return ['sessions', 'closures', 'publicKey', 'privateKey', 'config', 'lessons', 'attendance'].includes(p[1]);
  return false;
}

/**
 * May one write of a request go ahead? (database.rules.json `.write` and
 * `.validate`.) `before(parts)` reads the database as it is; `after(parts)`
 * reads it as it would be with every write of this request applied (Firebase's
 * `root` and `newData`). `now` is the request's server time.
 */
export function allowed(p, before, after, now) {
  const data = before(p);
  const v = after(p);
  const [top, a, b, c] = p;
  const admin = (secret) => isStr(secret) && before(['booking', 'admin', secret]) === true;
  const deleting = v === null;

  if (top === 'poules') {
    if (!CODE.test(a ?? '')) return false;
    if (p.length === 2)
      return (
        data !== null &&
        deleting &&
        isStr(after(['deletions', a])) &&
        before(['owners', a, after(['deletions', a])]) !== null
      );
    if (b === 'meta' && p.length === 3) return data === null && has(v, ['id', 'name', 'fencers', 'bouts']);
    if (b === 'results' && p.length >= 4) {
      if (before(['poules', a, 'meta']) === null || c.length > 80) return false;
      const r = after(['poules', a, 'results', c]);
      if (r === null) return true;
      return (
        has(r, ['scoreL', 'scoreR', 'winnerId']) &&
        isNum(r.scoreL) &&
        isNum(r.scoreR) &&
        r.scoreL >= 0 &&
        r.scoreL <= 99 &&
        r.scoreR >= 0 &&
        r.scoreR <= 99 &&
        strMax(r.winnerId, 80)
      );
    }
    return false;
  }
  if (top === 'owners' && p.length === 3)
    return (
      data === null &&
      before(['poules', a, 'meta']) === null &&
      CODE.test(a) &&
      isBool(v) &&
      b.length >= 20 &&
      b.length <= 64
    );
  if (top === 'deletions' && p.length === 2) return before(['owners', a]) !== null && (deleting || strMax(v, 64));

  if (top === 'club') {
    // Organiser writes, proved by a one-time op written with the organiser secret in the same request.
    const op = v?.op;
    const opOk =
      isStr(op) &&
      op.length <= 40 &&
      before(['booking', 'adminOps', 'cfg', op]) === null &&
      isStr(after(['booking', 'adminOps', 'cfg', op]));
    const link = (k) => v[k] == null || (strMax(v[k], 300) && (v[k] === '' || v[k].startsWith('https://')));
    if (a === 'about' && p.length === 2)
      return (
        opOk &&
        ['su', 'whatsapp', 'instagram', 'tiktok', 'feedback'].every(link) &&
        (v.email == null || strMax(v.email, 120)) &&
        (v.tagline == null || strMax(v.tagline, 120))
      );
    if (a === 'photos' && p.length === 3)
      return (
        /^[a-z0-9]{1,40}$/.test(b) &&
        opOk &&
        (v.deleted === true ||
          (strMax(v.src, 1_000_000) &&
            v.src.startsWith('data:image/jpeg;base64,') &&
            (v.caption == null || strMax(v.caption, 80))))
      );
    return false;
  }

  if (top !== 'booking') return false;

  if (a === 'publicKey') return p.length === 2 && data === null && isStr(v) && v.length < 1000;
  if (a === 'privateKey') return p.length === 2 && data === null && has(v, ['salt', 'iv', 'data']);
  if (a === 'admin') return p.length === 3 && before(['booking', 'admin']) === null && b.length === 64 && v === true;

  if (a === 'adminOps') {
    // Organiser proofs: the organiser secret, checked against booking/admin.
    const once = { close: 5, cfg: 4, ck: 5, att: 4 };
    const any = { rm: 5, rmLesson: 6 };
    if (once[b] === p.length) return data === null && admin(v);
    if (any[b] === p.length) return admin(v);
    return false;
  }

  if (a === 'sessions' && p.length === 4) {
    const [, , s, id] = p;
    if (data === null && !deleting)
      return (
        SESSION.test(s) &&
        id.length <= 40 &&
        isObj(v) &&
        Object.keys(v).sort().join(',') === 'createdAt,enc,name' &&
        isStr(v.name) &&
        v.name.length >= 2 &&
        v.name.length <= 60 &&
        strMax(v.enc, 1200) &&
        v.createdAt === now
      );
    if (data === null || !deleting) return false;
    const key = after(['booking', 'cancels', s, id]);
    const rm = after(['booking', 'adminOps', 'rm', s, id]);
    return (isStr(key) && before(['booking', 'keys', s, id, key]) !== null) || (isStr(rm) && admin(rm));
  }
  if (a === 'keys' && p.length === 5)
    return (
      data === null &&
      before(['booking', 'sessions', b, c]) === null &&
      p[4].length >= 20 &&
      p[4].length <= 64 &&
      v === true
    );
  if (a === 'cancels' && p.length === 4) return before(['booking', 'sessions', b, c]) !== null && strMax(v, 64);

  if (a === 'lessons' && p.length === 5) {
    const [, , s, coach, id] = p;
    if (data === null && !deleting)
      return (
        SESSION.test(s) &&
        coach.length <= 40 &&
        id.length <= 40 &&
        isObj(v) &&
        Object.keys(v).sort().join(',') === 'createdAt,name' &&
        isStr(v.name) &&
        v.name.length >= 2 &&
        v.name.length <= 60 &&
        v.createdAt === now
      );
    if (data === null || !deleting) return false;
    const key = after(['booking', 'lessonCancels', s, coach, id]);
    const rm = after(['booking', 'adminOps', 'rmLesson', s, coach, id]);
    return (isStr(key) && before(['booking', 'lessonKeys', s, coach, id, key]) !== null) || (isStr(rm) && admin(rm));
  }
  if (a === 'lessonKeys' && p.length === 6)
    return (
      data === null &&
      before(['booking', 'lessons', b, c, p[4]]) === null &&
      p[5].length >= 20 &&
      p[5].length <= 64 &&
      v === true
    );
  if (a === 'lessonCancels' && p.length === 5)
    return before(['booking', 'lessons', b, c, p[4]]) !== null && strMax(v, 64);

  if (a === 'closures' && p.length === 4)
    return (
      data === null &&
      isStr(after(['booking', 'adminOps', 'close', b, c])) &&
      isObj(v) &&
      isBool(v.closed) &&
      v.at === now &&
      (v.reason == null || strMax(v.reason, 120))
    );

  if (a === 'config' && p.length === 4) {
    const op = v?.op;
    return (
      ['weekly', 'events', 'overrides', 'meta'].includes(b) &&
      c.length <= 60 &&
      isStr(op) &&
      op.length <= 40 &&
      before(['booking', 'adminOps', 'cfg', op]) === null &&
      isStr(after(['booking', 'adminOps', 'cfg', op])) &&
      (v.title == null || (isStr(v.title) && v.title.length >= 2 && v.title.length <= 60)) &&
      (v.start == null || (isStr(v.start) && TIME.test(v.start))) &&
      (v.end == null || (isStr(v.end) && TIME.test(v.end))) &&
      (v.capacity == null || (isNum(v.capacity) && v.capacity >= 1 && v.capacity <= 500)) &&
      (v.offsite == null || isBool(v.offsite)) &&
      (v.note == null || strMax(v.note, 80)) &&
      (v.day == null || (isNum(v.day) && v.day >= 0 && v.day <= 6)) &&
      (v.date == null || (isStr(v.date) && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v.date))) &&
      ((b !== 'weekly' && b !== 'events') || /^[a-z0-9-]{1,40}$/.test(c))
    );
  }

  if (a === 'checkin' && p.length === 4)
    return (
      data === null &&
      v === true &&
      SESSION.test(b) &&
      /^[A-HJKMNP-Z2-9]{8}$/.test(c) &&
      admin(after(['booking', 'adminOps', 'ck', b, c]))
    );
  if (a === 'attendProofs' && p.length === 4)
    return before(['booking', 'sessions', b, c]) !== null && isObj(v) && strMax(v.key, 64) && strMax(v.code, 16);
  if (a === 'attendance' && p.length === 4) {
    if (!SESSION.test(b) || c.length > 40 || !isObj(v)) return false;
    const valid =
      isBool(v.present) &&
      v.at === now &&
      (v.name == null || (isStr(v.name) && v.name.length >= 2 && v.name.length <= 60)) &&
      (v.enc == null || strMax(v.enc, 1200)) &&
      (v.walkIn == null || isBool(v.walkIn));
    if (!valid) return false;
    if (v.how === 'org')
      return (
        isStr(v.op) &&
        v.op.length <= 40 &&
        before(['booking', 'adminOps', 'att', v.op]) === null &&
        isStr(after(['booking', 'adminOps', 'att', v.op]))
      );
    if (v.how !== 'self' || v.present !== true || data !== null) return false;
    const proof = after(['booking', 'attendProofs', b, c]);
    return (
      isStr(proof?.key) &&
      isStr(proof?.code) &&
      before(['booking', 'keys', b, c, proof.key]) !== null &&
      before(['booking', 'checkin', b, proof.code]) !== null
    );
  }
  return false;
}

/**
 * The database. `tree` is the starting data; `persist(writes)` is called with
 * each request's [parts, value] writes once they're accepted.
 */
export class Database {
  constructor({ tree = null, persist = () => {} } = {}) {
    this.tree = tree;
    this.persist = persist;
    this.listeners = new Set();
  }

  get(parts) {
    return getIn(this.tree, parts);
  }

  /** Read. Returns { status, body }. */
  read(parts, startAt = null) {
    if (!readable(parts)) return { status: 401, body: { error: 'Permission denied' } };
    return { status: 200, body: query(this.get(parts), startAt) };
  }

  /**
   * Write (PUT, PATCH or DELETE), all or nothing. Returns { status, body }.
   */
  write(method, parts, raw, now = Date.now()) {
    const body = serverValues(raw, now);
    let writes;
    if (method === 'PUT') writes = [[parts, body]];
    else if (method === 'DELETE') writes = [[parts, null]];
    else if (method === 'PATCH') {
      if (!isObj(body)) return { status: 400, body: { error: 'Invalid data' } };
      writes = Object.entries(body).map(([k, x]) => [[...parts, ...split(k)], x]);
    } else return { status: 405, body: { error: 'Method not allowed' } };
    if (!writes.length || writes.some(([p]) => !TOP.includes(p[0])))
      return { status: 401, body: { error: 'Permission denied' } };

    // The database as it would be after this request (Firebase's newData).
    const after = (q) => {
      let value = structuredClone(this.get(q));
      for (const [w, x] of writes) {
        if (startsWith(q, w)) value = structuredClone(getIn(x, q.slice(w.length)));
        else if (startsWith(w, q)) {
          const rest = w.slice(q.length);
          if (!isObj(value)) value = {};
          let node = value;
          for (const k of rest.slice(0, -1)) {
            if (!isObj(node[k])) node[k] = {};
            node = node[k];
          }
          node[rest.at(-1)] = structuredClone(x);
        }
      }
      value = prune(value);
      return isObj(value) && !Object.keys(value).length ? null : (value ?? null);
    };
    const before = (q) => this.get(q);
    const ok = writes.every(([p]) => {
      try {
        return allowed(p, before, after, now);
      } catch {
        return false;
      }
    });
    if (!ok) return { status: 401, body: { error: 'Permission denied' } };

    for (const [p, x] of writes) this.setAt(p, x);
    this.persist(writes);
    this.broadcast(
      writes.map(([p]) => p),
      method === 'PATCH',
    );
    return { status: 200, body: method === 'DELETE' ? null : body };
  }

  setAt(parts, value) {
    value = value && typeof value === 'object' ? prune(structuredClone(value)) : value;
    if (!parts.length) return void (this.tree = value ?? null);
    if (!isObj(this.tree)) this.tree = {};
    let node = this.tree;
    for (const k of parts.slice(0, -1)) {
      if (!isObj(node[k])) node[k] = {};
      node = node[k];
    }
    const last = parts.at(-1);
    if (value === null || value === undefined) delete node[last];
    else node[last] = value;
    prune(this.tree);
  }

  /** Bring in a whole export (only into an empty database). */
  importAll(data) {
    if (this.tree && Object.keys(this.tree).length) return { status: 409, body: { error: 'The database isn’t empty' } };
    if (!isObj(data) || Object.keys(data).some((k) => !TOP.includes(k)))
      return { status: 400, body: { error: 'That isn’t an export of the club database' } };
    const tree = prune(structuredClone(data));
    this.tree = tree;
    this.persist([[[], tree]]);
    this.broadcast([[]], false);
    return { status: 200, body: { imported: Object.keys(tree) } };
  }

  /** Watch a path: send(event, data) now and on every change. Returns a function to stop. */
  subscribe(parts, startAt, send) {
    const l = { parts, startAt, send };
    this.listeners.add(l);
    send('put', { path: '/', data: query(this.get(parts), startAt) });
    return () => this.listeners.delete(l);
  }

  /**
   * Tell watchers about a request's writes, the way Firebase does: a single
   * write is a 'put' at its path; a multi-path PATCH is one 'patch' event
   * whose keys are paths relative to the watcher ("2026-10-21_wed-clfc/b123").
   */
  broadcast(paths, multi) {
    for (const l of this.listeners) {
      try {
        const inside = paths.filter((p) => startsWith(p, l.parts) && p.length > l.parts.length);
        const above = paths.some((p) => startsWith(l.parts, p));
        const rel = inside.map((p) => p.slice(l.parts.length)).filter((r) => l.startAt == null || r[0] >= l.startAt);
        if (above) l.send('put', { path: '/', data: query(this.get(l.parts), l.startAt) });
        else if (!rel.length) continue;
        else if (multi)
          l.send('patch', {
            path: '/',
            data: Object.fromEntries(rel.map((r) => [r.join('/'), this.get([...l.parts, ...r])])),
          });
        else for (const r of rel) l.send('put', { path: `/${r.join('/')}`, data: this.get([...l.parts, ...r]) });
      } catch {
        this.listeners.delete(l); // a closed connection
      }
    }
  }
}

/** Every leaf of a value as [path, value] (for storing the tree row by row). */
export function leaves(value, prefix = []) {
  if (!isObj(value)) return value == null ? [] : [[prefix, value]];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, [...prefix, k]));
}

/** Parse a request URL into { parts, startAt, special }. */
export function parseUrl(pathname, searchParams) {
  if (pathname === '/.import') return { special: 'import' };
  if (!pathname.endsWith('.json')) return null;
  let startAt = null;
  if (searchParams.has('startAt')) {
    try {
      startAt = JSON.parse(searchParams.get('startAt'));
    } catch {
      return null;
    }
  }
  return { parts: split(decodeURIComponent(pathname.slice(0, -5))), startAt };
}
