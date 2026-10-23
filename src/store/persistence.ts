// Local persistence. IndexedDB when available; falls back to localStorage, then
// to memory (private windows can block both). Nothing ever leaves the device.

const DB_NAME = 'terpene-lab-synth';
const DB_VERSION = 1;
const STORES = ['profiles', 'presets', 'mappings', 'kv'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, Map<string, unknown>>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function lsKey(store: StoreName, key: string) { return `tls:${store}:${key}`; }

export async function put(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      return;
    } catch { /* fall through */ }
  }
  try { localStorage.setItem(lsKey(store, key), JSON.stringify(value)); return; } catch { /* fall through */ }
  if (!memory.has(store)) memory.set(store, new Map());
  memory.get(store)!.set(key, value);
}

export async function del(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch { /* ignore */ }
  }
  try { localStorage.removeItem(lsKey(store, key)); } catch { /* ignore */ }
  memory.get(store)?.delete(key);
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  if (db) {
    try {
      return await new Promise<T[]>((res, rej) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res(req.result as T[]);
        req.onerror = () => rej(req.error);
      });
    } catch { /* fall through */ }
  }
  const out: T[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(`tls:${store}:`)) out.push(JSON.parse(localStorage.getItem(k)!));
    }
  } catch { /* ignore */ }
  for (const v of memory.get(store)?.values() ?? []) out.push(v as T);
  return out;
}

export async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  if (db) {
    try {
      return await new Promise<T | undefined>((res, rej) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => res(req.result as T | undefined);
        req.onerror = () => rej(req.error);
      });
    } catch { /* fall through */ }
  }
  try {
    const v = localStorage.getItem(lsKey(store, key));
    if (v != null) return JSON.parse(v) as T;
  } catch { /* ignore */ }
  return memory.get(store)?.get(key) as T | undefined;
}
