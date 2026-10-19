// A small in-memory stand-in for the Firebase Realtime Database REST API, for
// local development and the end-to-end tests:
//   - GET / PUT / PATCH (multi-path, atomic) / DELETE on `/<path>.json`
//   - EventSource streaming (put events), `orderBy="$key"&startAt=` queries
//   - server timestamps ({ ".sv": "timestamp" }), CORS
//   - the essentials of database.rules.json for shared poules and bookings
//
//   node scripts/mock-share-server.js     (PORT, default 9000)
// Then in the browser console: localStorage.setItem('piste:shareDbUrl', 'http://localhost:9000')

import { createServer } from 'node:http';

const port = Number(process.env.PORT) || 9000;
let tree = null;
const listeners = new Set();

const CODE = /^[A-HJKMNP-Z2-9]{6}$/;
const SESSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[a-z0-9-]{1,40}$/;

const split = (p) => p.split('/').filter(Boolean);
function getAt(parts) {
  let node = tree;
  for (const k of parts) node = node && typeof node === 'object' ? node[k] : undefined;
  return node ?? null;
}
function setAt(parts, value) {
  if (!parts.length) return void (tree = value);
  if (!tree || typeof tree !== 'object') tree = {};
  let node = tree;
  for (const k of parts.slice(0, -1)) {
    if (!node[k] || typeof node[k] !== 'object') node[k] = {};
    node = node[k];
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
  prune(tree);
}
function prune(node) {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    prune(v);
    if (v && typeof v === 'object' && !Object.keys(v).length) delete node[k];
  }
}
/** Replace { ".sv": "timestamp" } with the server time. */
function serverValues(v, now) {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return now;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serverValues(x, now)]));
  }
  return v;
}
/** Apply an orderBy="$key"&startAt= query to an object. */
function query(value, startAt) {
  if (startAt == null || !value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k >= startAt));
}

const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const startsWith = (a, b) => b.every((k, i) => a[i] === k);

/**
 * Tell watchers about a request's writes, the way Firebase does: a single
 * write is a 'put' at its path; a multi-path PATCH is one 'patch' event whose
 * keys are paths relative to the watcher ("2026-10-21_wed-clfc/b123").
 */
function broadcast(paths, multi) {
  for (const l of listeners) {
    const inside = paths.filter((p) => startsWith(p, l.parts) && p.length > l.parts.length);
    const above = paths.some((p) => startsWith(l.parts, p));
    const rel = inside.map((p) => p.slice(l.parts.length)).filter((r) => l.startAt == null || r[0] >= l.startAt);
    if (above) send(l.res, 'put', { path: '/', data: query(getAt(l.parts), l.startAt) });
    else if (!rel.length) continue;
    else if (multi) {
      send(l.res, 'patch', {
        path: '/',
        data: Object.fromEntries(rel.map((r) => [r.join('/'), getAt([...l.parts, ...r])])),
      });
    } else for (const r of rel) send(l.res, 'put', { path: `/${r.join('/')}`, data: getAt([...l.parts, ...r]) });
  }
}

function denied(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Permission denied' }));
}

/** Which paths can be read. */
function readable(p) {
  if (p[0] === 'poules') return p.length >= 2 && CODE.test(p[1]);
  if (p[0] === 'club') return true;
  if (p[0] === 'booking')
    return ['sessions', 'closures', 'publicKey', 'privateKey', 'config', 'lessons', 'attendance'].includes(p[1]);
  return false;
}

/** The essentials of database.rules.json. `upd` holds every path written by this request. */
function allowed(p, v, upd) {
  const fresh = (path) => upd.get(path) ?? getAt(split(path));
  const [top, a, b, c] = p;

  if (top === 'poules') {
    if (!CODE.test(a ?? '')) return false;
    if (p.length === 2) {
      const secret = upd.get(`deletions/${a}`);
      return v === null && getAt(p) !== null && typeof secret === 'string' && getAt(['owners', a, secret]) === true;
    }
    if (b === 'meta' && p.length === 3) return getAt(p) === null && v && v.id && v.fencers && v.bouts;
    if (b === 'results' && p.length >= 4) {
      if (getAt(['poules', a, 'meta']) === null) return false;
      return (
        v === null ||
        p.length > 4 ||
        (Number.isInteger(v.scoreL) && Number.isInteger(v.scoreR) && typeof v.winnerId === 'string')
      );
    }
    return false;
  }
  if (top === 'owners' && p.length === 3) {
    return CODE.test(a) && getAt(p) === null && getAt(['poules', a, 'meta']) === null && v === true && b.length >= 20;
  }
  if (top === 'deletions' && p.length === 2) return getAt(['owners', a]) !== null && typeof v === 'string';

  if (top === 'club') {
    // The club page: organiser writes, proved with a one-time op (like config).
    const opOk =
      typeof v?.op === 'string' &&
      getAt(['booking', 'adminOps', 'cfg', v.op]) === null &&
      typeof upd.get(`booking/adminOps/cfg/${v.op}`) === 'string';
    if (a === 'about' && p.length === 2) {
      const links = ['su', 'whatsapp', 'instagram', 'tiktok'].every(
        (k) => v[k] == null || (typeof v[k] === 'string' && (v[k] === '' || v[k].startsWith('https://'))),
      );
      return opOk && links;
    }
    if (a === 'photos' && p.length === 3)
      return (
        opOk &&
        /^[a-z0-9]{1,40}$/.test(b) &&
        (v.deleted === true || (typeof v.src === 'string' && v.src.startsWith('data:image/jpeg;base64,')))
      );
    return false;
  }
  if (top === 'booking') {
    const isAdmin = (secret) => typeof secret === 'string' && getAt(['booking', 'admin', secret]) === true;
    if (a === 'publicKey' || a === 'privateKey') return p.length === 2 && getAt(p) === null && v != null;
    if (a === 'admin' && p.length === 3) return getAt(['booking', 'admin']) === null && b.length === 64 && v === true;
    if (a === 'sessions' && p.length === 4) {
      const [, , s, id] = p;
      if (getAt(p) === null) {
        if (v === null || !SESSION.test(s) || id.length > 40) return false;
        const keys = Object.keys(v).sort().join(',');
        return (
          keys === 'createdAt,enc,name' &&
          v.name.length >= 2 &&
          v.name.length <= 60 &&
          typeof v.enc === 'string' &&
          Math.abs(v.createdAt - Date.now()) < 5000
        );
      }
      if (v !== null) return false;
      const key = upd.get(`booking/cancels/${s}/${id}`);
      const selfCancel = typeof key === 'string' && getAt(['booking', 'keys', s, id, key]) === true;
      return selfCancel || isAdmin(upd.get(`booking/adminOps/rm/${s}/${id}`));
    }
    if (a === 'lessons' && p.length === 5) {
      const [, , s2, coach, id] = p;
      if (getAt(p) === null) {
        if (v === null || !SESSION.test(s2) || coach.length > 40 || id.length > 40) return false;
        return (
          Object.keys(v).sort().join(',') === 'createdAt,name' &&
          v.name.length >= 2 &&
          v.name.length <= 60 &&
          Math.abs(v.createdAt - Date.now()) < 5000
        );
      }
      if (v !== null) return false;
      const key = upd.get(`booking/lessonCancels/${s2}/${coach}/${id}`);
      return (
        (typeof key === 'string' && getAt(['booking', 'lessonKeys', s2, coach, id, key]) === true) ||
        isAdmin(upd.get(`booking/adminOps/rmLesson/${s2}/${coach}/${id}`))
      );
    }
    if (a === 'lessonKeys' && p.length === 6)
      return getAt(p) === null && getAt(['booking', 'lessons', b, c, p[4]]) === null && p[5].length >= 20 && v === true;
    if (a === 'lessonCancels' && p.length === 5)
      return getAt(['booking', 'lessons', b, c, p[4]]) !== null && typeof v === 'string';
    if (a === 'adminOps' && b === 'rmLesson' && p.length === 6) return isAdmin(v);
    if (a === 'keys' && p.length === 5)
      return getAt(p) === null && getAt(['booking', 'sessions', b, c]) === null && p[4].length >= 20 && v === true;
    if (a === 'cancels' && p.length === 4)
      return getAt(['booking', 'sessions', b, c]) !== null && typeof v === 'string';
    if (a === 'adminOps' && b === 'rm' && p.length === 5) return isAdmin(v);
    if (a === 'adminOps' && b === 'close' && p.length === 5) return getAt(p) === null && isAdmin(v);
    if (a === 'adminOps' && b === 'cfg' && p.length === 4) return getAt(p) === null && isAdmin(v);
    if (a === 'config' && p.length === 4) {
      // Timetable entries: each carries a one-time op written with the organiser secret in the same request.
      const op = v?.op;
      const okKind = ['weekly', 'events', 'overrides', 'meta'].includes(b);
      const time = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
      const fields =
        (v?.title == null || (typeof v.title === 'string' && v.title.length >= 2 && v.title.length <= 60)) &&
        (v?.start == null || time.test(v.start)) &&
        (v?.end == null || time.test(v.end)) &&
        (v?.capacity == null || (Number.isInteger(v.capacity) && v.capacity >= 1 && v.capacity <= 500)) &&
        ((b !== 'weekly' && b !== 'events') || /^[a-z0-9-]{1,40}$/.test(c));
      return (
        okKind &&
        fields &&
        typeof op === 'string' &&
        getAt(['booking', 'adminOps', 'cfg', op]) === null &&
        upd.has(`booking/adminOps/cfg/${op}`)
      );
    }
    // Attendance: the organiser (with a one-time op, like config) or the member
    // themselves (booking key + the check-in code shown at the door).
    if (a === 'adminOps' && (b === 'ck' ? p.length === 5 : b === 'att' && p.length === 4))
      return getAt(p) === null && isAdmin(v);
    if (a === 'checkin' && p.length === 4) {
      const op = upd.get(`booking/adminOps/ck/${b}/${c}`);
      return getAt(p) === null && v === true && SESSION.test(b) && /^[A-HJKMNP-Z2-9]{8}$/.test(c) && isAdmin(op);
    }
    if (a === 'attendProofs' && p.length === 4)
      return (
        getAt(['booking', 'sessions', b, c]) !== null &&
        typeof v?.key === 'string' &&
        typeof v?.code === 'string' &&
        v.key.length <= 64 &&
        v.code.length <= 16
      );
    if (a === 'attendance' && p.length === 4) {
      if (!SESSION.test(b) || c.length > 40 || !v) return false;
      const valid =
        typeof v.present === 'boolean' &&
        Math.abs(v.at - Date.now()) < 5000 &&
        (v.name == null || (typeof v.name === 'string' && v.name.length >= 2 && v.name.length <= 60)) &&
        (v.walkIn == null || typeof v.walkIn === 'boolean');
      if (!valid) return false;
      if (v.how === 'org')
        return (
          typeof v.op === 'string' &&
          getAt(['booking', 'adminOps', 'att', v.op]) === null &&
          typeof upd.get(`booking/adminOps/att/${v.op}`) === 'string'
        );
      if (v.how !== 'self' || v.present !== true || getAt(p) !== null) return false;
      const proof = fresh(`booking/attendProofs/${b}/${c}`);
      return (
        typeof proof?.key === 'string' &&
        getAt(['booking', 'keys', b, c, proof.key]) === true &&
        getAt(['booking', 'checkin', b, proof.code]) === true
      );
    }
    if (a === 'closures' && p.length === 4) {
      return (
        getAt(p) === null &&
        v &&
        typeof v.closed === 'boolean' &&
        typeof fresh(`booking/adminOps/close/${b}/${c}`) === 'string' &&
        upd.has(`booking/adminOps/close/${b}/${c}`)
      );
    }
    return false;
  }
  return false;
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.endsWith('.json')) return res.writeHead(404).end();
  const parts = split(decodeURIComponent(url.pathname.slice(0, -5)));
  const startAt = url.searchParams.has('startAt') ? JSON.parse(url.searchParams.get('startAt')) : null;

  if (req.method === 'GET') {
    if (!readable(parts)) return denied(res);
    if ((req.headers.accept ?? '').includes('text/event-stream')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const l = { parts, res, startAt };
      listeners.add(l);
      send(res, 'put', { path: '/', data: query(getAt(parts), startAt) });
      const ka = setInterval(() => send(res, 'keep-alive', null), 15000);
      req.on('close', () => (listeners.delete(l), clearInterval(ka)));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(query(getAt(parts), startAt)));
  }

  let raw = '';
  for await (const chunk of req) raw += chunk;
  const now = Date.now();
  const body = serverValues(raw ? JSON.parse(raw) : null, now);
  // Turn the request into a list of [path, value] writes (PATCH = multi-path).
  let writes;
  if (req.method === 'PUT') writes = [[parts, body]];
  else if (req.method === 'DELETE') writes = [[parts, null]];
  else if (req.method === 'PATCH') writes = Object.entries(body ?? {}).map(([k, v]) => [[...parts, ...split(k)], v]);
  else return res.writeHead(405).end();
  const update = new Map(writes.map(([p, v]) => [p.join('/'), v]));
  if (!writes.every(([p, v]) => allowed(p, v, update))) return denied(res); // atomic, like Firebase
  for (const [p, v] of writes) setAt(p, v);
  broadcast(
    writes.map(([p]) => p),
    req.method === 'PATCH',
  );
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(req.method === 'DELETE' ? null : body));
});

server.listen(port, () => console.log(`Mock sharing server on http://localhost:${port}`));
