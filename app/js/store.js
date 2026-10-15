// On-device storage. IndexedDB when available, falling back to localStorage
// (e.g. some private-browsing modes) so the app always works.
//
// Object stores:
//   poules   Poule records (keyPath id)
//   fencers  the reusable roster (keyPath id)
//   bouts    finished free-standing bouts (keyPath id)
//   matches  team matches (keyPath id)
//   kv       settings and the in-progress bout ({ key, value })

const DB_NAME = 'piste';
const DB_VERSION = 2;
const STORES = ['poules', 'fencers', 'bouts', 'matches'];

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

const promisify = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

class IdbBackend {
  constructor(db) {
    this.db = db;
  }
  tx(store, mode = 'readonly') {
    return this.db.transaction(store, mode).objectStore(store);
  }
  getAll(store) {
    return promisify(this.tx(store).getAll());
  }
  get(store, id) {
    return promisify(this.tx(store).get(id));
  }
  put(store, value) {
    return promisify(this.tx(store, 'readwrite').put(value));
  }
  delete(store, id) {
    return promisify(this.tx(store, 'readwrite').delete(id));
  }
  async putMany(store, values) {
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const v of values) os.put(v);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
}

class LocalBackend {
  key(store) {
    return `piste:${store}`;
  }
  read(store) {
    try {
      return JSON.parse(localStorage.getItem(this.key(store)) || '{}');
    } catch {
      return {};
    }
  }
  write(store, obj) {
    try {
      localStorage.setItem(this.key(store), JSON.stringify(obj));
    } catch (e) {
      console.warn('Storage write failed', e);
    }
  }
  idOf(store, v) {
    return store === 'kv' ? v.key : v.id;
  }
  async getAll(store) {
    return Object.values(this.read(store));
  }
  async get(store, id) {
    return this.read(store)[id];
  }
  async put(store, value) {
    const all = this.read(store);
    all[this.idOf(store, value)] = value;
    this.write(store, all);
  }
  async delete(store, id) {
    const all = this.read(store);
    delete all[id];
    this.write(store, all);
  }
  async putMany(store, values) {
    const all = this.read(store);
    for (const v of values) all[this.idOf(store, v)] = v;
    this.write(store, all);
  }
}

let backend;

export async function openStore() {
  try {
    backend = new IdbBackend(await idbOpen());
  } catch (e) {
    console.warn('IndexedDB unavailable, using localStorage', e);
    backend = new LocalBackend();
  }
  // Ask the browser not to evict our data under storage pressure.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
  return backend;
}

// Writes are serialised per key so a burst of quick taps can't land out of order.
let chain = Promise.resolve();
const queue = (fn) => (chain = chain.then(fn, fn).catch((e) => console.error('Storage error', e)));

export const getAll = (store) => backend.getAll(store);
export const put = (store, value) => queue(() => backend.put(store, structuredClone(value)));
export const remove = (store, id) => queue(() => backend.delete(store, id));
export async function kvGet(key, fallback = null) {
  const row = await backend.get('kv', key);
  return row ? row.value : fallback;
}
export const kvSet = (key, value) => queue(() => backend.put('kv', { key, value: structuredClone(value) }));
export const flush = () => chain;

export async function exportAll() {
  await flush();
  const [poules, fencers, bouts, matches, kv] = await Promise.all([
    backend.getAll('poules'),
    backend.getAll('fencers'),
    backend.getAll('bouts'),
    backend.getAll('matches'),
    backend.getAll('kv'),
  ]);
  return {
    app: 'piste',
    format: 1,
    exportedAt: new Date().toISOString(),
    poules,
    fencers,
    bouts,
    matches,
    kv,
  };
}

/** Merge an export into local data (records with the same id are replaced). */
export async function importAll(data) {
  if (!data || data.app !== 'piste') throw new Error('Not a Piste backup file');
  const counts = {};
  for (const store of STORES) {
    const rows = Array.isArray(data[store]) ? data[store].filter((r) => r && r.id) : [];
    await backend.putMany(store, rows);
    counts[store] = rows.length;
  }
  const kv = Array.isArray(data.kv) ? data.kv.filter((r) => r && r.key === 'settings') : [];
  if (kv.length) await backend.putMany('kv', kv);
  return counts;
}
