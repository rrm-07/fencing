// The club database (server/db.js) over Node's HTTP server: the same REST API
// and live streams as on Cloudflare. Used by the local servers.

import { Database, parseUrl, MAX_BODY } from '../server/db.js';

export function createDb() {
  return new Database();
}

/** Answer one request for `pathname` (relative to the database root). */
export async function handleDb(db, req, res, pathname) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,PATCH,DELETE,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, 'http://x');
  const route = parseUrl(pathname, url.searchParams);
  const reply = ({ status, body }) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (!route) return reply({ status: 404, body: { error: 'Not found' } });

  if (req.method === 'GET' && !route.special) {
    const r = db.read(route.parts, route.startAt);
    if (r.status !== 200 || !(req.headers.accept ?? '').includes('text/event-stream')) return reply(r);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const stop = db.subscribe(route.parts, route.startAt, send);
    const ka = setInterval(() => send('keep-alive', null), 15000);
    req.on('close', () => (stop(), clearInterval(ka)));
    return;
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) return reply({ status: 413, body: { error: 'Too large' } });
  }
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    return reply({ status: 400, body: { error: 'Invalid JSON' } });
  }
  if (route.special === 'import') return reply(db.importAll(body));
  reply(db.write(req.method, route.parts, body, Date.now()));
}
