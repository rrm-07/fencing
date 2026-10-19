// The database for the end-to-end tests: the mock server by default, or the
// official Firebase Realtime Database emulator running the real
// database.rules.json when FIREBASE_EMULATOR_JAR points at its .jar
// (see README → Tests).

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startDb(port) {
  const url = `http://localhost:${port}`;
  const jar = process.env.FIREBASE_EMULATOR_JAR;
  const proc = jar
    ? spawn('java', ['-jar', jar, '--port', String(port)], { stdio: 'ignore' })
    : spawn(process.execPath, ['scripts/mock-share-server.js'], {
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
      });
  if (jar) {
    // Wait for it to listen, then load the real rules.
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(`${url}/.json`);
        break;
      } catch {
        await wait(500);
      }
    }
    const res = await fetch(`${url}/.settings/rules.json`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer owner' },
      body: await readFile(new URL('../database.rules.json', import.meta.url)),
    });
    if (!res.ok) throw new Error(`Rules rejected by the emulator: ${await res.text()}`);
  } else await wait(500);
  return { url, kind: jar ? 'Firebase emulator' : 'mock server', stop: () => proc.kill() };
}
