// A tiny in-memory stand-in for the Firebase Realtime Database REST API, for
// local development and the end-to-end tests: GET/PUT/PATCH/DELETE on
// `/<path>.json`, EventSource streaming (put/patch events), CORS, and the
// essentials of database.rules.json (meta is write-once, /poules can't be listed).
//   node scripts/mock-share-server.js     (PORT, default 9000)
// Then in the browser console: localStorage.setItem('piste:shareDbUrl', 'http://localhost:9000')
import { createServer } from 'node:http';

const port = Number(process.env.PORT) || 9000;
let tree = null;
const listeners = new Set();

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
}

const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const startsWith = (a, b) => b.every((k, i) => a[i] === k);

function broadcast(parts, kind, body) {
  for (const l of listeners) {
    if (startsWith(parts, l.parts)) {
      const rel = '/' + parts.slice(l.parts.length).join('/');
      send(l.res, kind, { path: rel, data: kind === 'patch' ? body : getAt(parts) });
    } else if (startsWith(l.parts, parts)) {
      send(l.res, 'put', { path: '/', data: getAt(l.parts) });
    }
  }
}

function denied(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Permission denied' }));
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.endsWith('.json')) return res.writeHead(404).end();
  const parts = split(decodeURIComponent(url.pathname.slice(0, -5)));
  const CODE = /^[A-HJKMNP-Z2-9]{6}$/;
  if (req.method === 'GET') {
    // Only a single poule can be read: no listing, no owner keys.
    if (parts[0] !== 'poules' || parts.length < 2 || !CODE.test(parts[1])) return denied(res);
    if ((req.headers.accept ?? '').includes('text/event-stream')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const l = { parts, res };
      listeners.add(l);
      send(res, 'put', { path: '/', data: getAt(parts) });
      const ka = setInterval(() => send(res, 'keep-alive', null), 15000);
      req.on('close', () => (listeners.delete(l), clearInterval(ka)));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getAt(parts)));
  }

  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  // Turn the request into a list of [path, value] writes (PATCH = multi-path).
  let writes;
  if (req.method === 'PUT') writes = [[parts, body]];
  else if (req.method === 'DELETE') writes = [[parts, null]];
  else if (req.method === 'PATCH') writes = Object.entries(body ?? {}).map(([k, v]) => [[...parts, ...split(k)], v]);
  else return res.writeHead(405).end();
  const update = new Map(writes.map(([p, v]) => [p.join('/'), v]));
  if (!writes.every(([p, v]) => allowed(p, v, update))) return denied(res); // atomic, like Firebase
  for (const [p, v] of writes) setAt(p, v);
  for (const [p, v] of writes) broadcast(p, 'put', v);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(req.method === 'DELETE' ? null : body));

  // The essentials of database.rules.json.
  function allowed(p, v, upd) {
    const [top, code, child, key] = p;
    if (!CODE.test(code ?? '')) return false;
    if (top === 'poules' && p.length === 2) {
      const secret = upd.get(`deletions/${code}`);
      return v === null && getAt(p) !== null && typeof secret === 'string' && getAt(['owners', code, secret]) === true;
    }
    if (top === 'poules' && child === 'meta' && p.length === 3)
      return getAt(p) === null && v && v.id && v.fencers && v.bouts;
    if (top === 'poules' && child === 'results' && p.length >= 4) {
      if (getAt(['poules', code, 'meta']) === null) return false;
      return (
        v === null ||
        p.length > 4 ||
        (Number.isInteger(v.scoreL) && Number.isInteger(v.scoreR) && typeof v.winnerId === 'string')
      );
    }
    if (top === 'owners' && p.length === 3) {
      return (
        getAt(p) === null &&
        getAt(['poules', code, 'meta']) === null &&
        v === true &&
        child.length >= 20 &&
        key === undefined
      );
    }
    if (top === 'deletions' && p.length === 2) return getAt(['owners', code]) !== null && typeof v === 'string';
    return false;
  }
});

server.listen(port, () => console.log(`Mock sharing server on http://localhost:${port}`));
