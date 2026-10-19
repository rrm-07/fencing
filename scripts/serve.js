// Local development server: `npm start`. Like the live site, it serves ./app
// and the club database at /db (kept in memory). http://localhost:8080 (PORT
// env to change). No dependencies.
import { createServer } from 'node:http';
import { createDb, handleDb } from './db-http.js';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = resolve(new URL('../app', import.meta.url).pathname);
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * The headers from app/_headers (what Cloudflare sends), so local testing
 * matches production. Locally the database may be on localhost (the mock
 * server or the Firebase emulator), so that is allowed too.
 */
async function loadHeaders() {
  const text = await readFile(join(root, '_headers'), 'utf8').catch(() => '');
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: {} });
    else if (rules.length) {
      const i = line.indexOf(':');
      rules.at(-1).headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}
const headerRules = await loadHeaders();
function headersFor(path) {
  const out = {};
  for (const r of headerRules) {
    const re = new RegExp(`^${r.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (re.test(path)) Object.assign(out, r.headers);
  }
  const csp = out['Content-Security-Policy'];
  if (csp) out['Content-Security-Policy'] = csp.replace('connect-src', 'connect-src http://localhost:*');
  return out;
}

const db = createDb();

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname === '/db' || pathname.startsWith('/db/')) return handleDb(db, req, res, pathname.slice(3) || '/');
  try {
    let path = decodeURIComponent(pathname);
    path = normalize(path).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root)) throw new Error('forbidden');
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    if (file.endsWith('_headers')) throw new Error('not served');
    const body = await readFile(file);
    res.writeHead(200, {
      'Cache-Control': 'no-cache',
      ...headersFor(path),
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Piste running at http://localhost:${port}/`);
  for (const nets of Object.values(networkInterfaces())) {
    for (const n of nets ?? [])
      if (n.family === 'IPv4' && !n.internal) console.log(`  on your network: http://${n.address}:${port}/`);
  }
});
