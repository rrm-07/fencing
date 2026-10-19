// The database for the end-to-end tests:
//   default                   the club database code (server/db.js) in a local Node server
//   E2E_DB=cloudflare         the real thing: server/worker.js in Cloudflare's runtime
//                             (`wrangler dev`, a fresh Durable Object each run)
//   FIREBASE_EMULATOR_JAR=…   the old Firebase database's emulator with database.rules.json
// (see README → Tests).

import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await wait(500);
    }
  }
  throw new Error(`Nothing answered at ${url}`);
}

export async function startDb(port) {
  const jar = process.env.FIREBASE_EMULATOR_JAR;
  if (process.env.E2E_DB === 'cloudflare') {
    const state = await mkdtemp(join(tmpdir(), 'piste-do-'));
    const bin = process.env.WRANGLER_BIN ?? 'npx';
    const args = [
      ...(bin === 'npx' ? ['--yes', 'wrangler@4'] : []),
      'dev',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      state,
      '--log-level',
      'error',
    ];
    const proc = spawn(bin, args, { stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    const url = `http://localhost:${port}/db`;
    await until(`${url}/club.json`);
    return { url, kind: 'Cloudflare (wrangler dev)', stop: () => proc.kill() };
  }
  const url = `http://localhost:${port}`;
  const proc = jar
    ? spawn('java', ['-jar', jar, '--port', String(port)], { stdio: 'ignore' })
    : spawn(process.execPath, ['scripts/mock-share-server.js'], {
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
      });
  if (jar) {
    await until(`${url}/.json`);
    const res = await fetch(`${url}/.settings/rules.json`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer owner' },
      body: await readFile(new URL('../database.rules.json', import.meta.url)),
    });
    if (!res.ok) throw new Error(`Rules rejected by the emulator: ${await res.text()}`);
  } else await wait(500);
  return { url, kind: jar ? 'Firebase emulator' : 'local club database', stop: () => proc.kill() };
}
