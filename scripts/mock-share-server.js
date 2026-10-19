// The club database on its own, for the end-to-end tests: the same code
// (server/db.js) that runs on Cloudflare, kept in memory.
//
//   node scripts/mock-share-server.js     (PORT, default 9000)
// Then in the browser console: localStorage.setItem('piste:shareDbUrl', 'http://localhost:9000')

import { createServer } from 'node:http';
import { createDb, handleDb } from './db-http.js';

const port = Number(process.env.PORT) || 9000;
const db = createDb();
createServer((req, res) => handleDb(db, req, res, new URL(req.url, 'http://x').pathname)).listen(port, () =>
  console.log(`Club database (local) on http://localhost:${port}`),
);
