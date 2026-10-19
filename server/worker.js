// Cloudflare: the app's files (app/, served as static assets) and the club
// database at /db/…, kept in a Durable Object with its own SQLite storage.
// One object holds the whole database, so every write is applied in order
// and live updates go straight to everyone watching.

import { DurableObject } from 'cloudflare:workers';
import { Database, leaves, parseUrl, MAX_BODY } from './db.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/db' || url.pathname.startsWith('/db/'))
      return env.DB.get(env.DB.idFromName('club')).fetch(request);
    return env.ASSETS.fetch(request);
  },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,PATCH,DELETE,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });

export class ClubDatabase extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    // Load the tree: each leaf is a row keyed by its path.
    let tree = null;
    for (const row of this.sql.exec('SELECT k, v FROM kv')) {
      tree ??= {};
      const parts = row.k.split('/');
      let node = tree;
      for (const p of parts.slice(0, -1)) node = node[p] ??= {};
      node[parts.at(-1)] = JSON.parse(row.v);
    }
    this.db = new Database({ tree, persist: (writes) => this.persist(writes) });
  }

  /** Store accepted writes: replace the rows under each written path. */
  persist(writes) {
    this.ctx.storage.transactionSync(() => {
      for (const [parts, value] of writes) {
        const k = parts.join('/');
        if (!k) this.sql.exec('DELETE FROM kv');
        else this.sql.exec('DELETE FROM kv WHERE k = ? OR (k >= ? AND k < ?)', k, `${k}/`, `${k}0`);
        for (const [p, v] of leaves(value, parts))
          this.sql.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', p.join('/'), JSON.stringify(v));
      }
    });
  }

  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const route = parseUrl(url.pathname.replace(/^\/db/, '') || '/', url.searchParams);
    if (!route) return json(404, { error: 'Not found' });

    if (request.method === 'GET' && !route.special) {
      const res = this.db.read(route.parts, route.startAt);
      if (res.status !== 200 || !(request.headers.get('Accept') ?? '').includes('text/event-stream'))
        return json(res.status, res.body);
      return this.stream(request, route);
    }

    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: 'Too large' });
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }
    if (route.special === 'import') {
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
      const res = this.db.importAll(body);
      return json(res.status, res.body);
    }
    const res = this.db.write(request.method, route.parts, body, Date.now());
    return json(res.status, res.body);
  }

  /** A live stream (Server-Sent Events, like Firebase's REST streaming). */
  stream(request, { parts, startAt }) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    let stop = null;
    let timer = null;
    const close = () => {
      stop?.();
      clearInterval(timer);
      writer.close().catch(() => {});
    };
    const send = (event, data) => {
      writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(close);
    };
    stop = this.db.subscribe(parts, startAt, send);
    timer = setInterval(() => send('keep-alive', null), 15_000);
    request.signal?.addEventListener('abort', close);
    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS },
    });
  }
}
