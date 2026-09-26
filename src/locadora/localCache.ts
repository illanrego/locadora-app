import type { DiscoveryTitle } from '../domain/content';
import type { ShelfPage, ShelfQuery } from './discovery';

type Store = 'shelves' | 'titles';
const LIMITS: Record<Store, number> = { shelves: 96, titles: 4_000 };
const session: Record<Store, Map<string, unknown>> = { shelves: new Map(), titles: new Map() };
let database: Promise<IDBDatabase | null> | undefined;

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function remember(store: Store, key: string, value: unknown): void {
  const entries = session[store];
  entries.delete(key);
  entries.set(key, value);
  while (entries.size > LIMITS[store]) entries.delete(entries.keys().next().value!);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (database) return database;
  database = (async () => {
    try {
      if (typeof indexedDB === 'undefined') return null;
      const opening = indexedDB.open('wills-locadora-catalogue', 1);
      opening.onupgradeneeded = () => {
        for (const name of ['shelves', 'titles']) {
          opening.result.createObjectStore(name, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
        }
      };
      const db = await request(opening);
      db.onversionchange = () => { db.close(); database = undefined; };
      // Old details have no language. Only shelves can be migrated safely.
      try {
        const old = JSON.parse(localStorage.getItem('wills-locadora.catalog-cache.v1') ?? 'null');
        if (old?.version === 1 && old.shelves) {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('shelves', 'readwrite');
            const store = tx.objectStore('shelves');
            Object.entries(old.shelves).slice(0, LIMITS.shelves).forEach(([key, entry]) => {
              const record = entry as { page?: ShelfPage; savedAt?: number };
              if (Array.isArray(record?.page?.titles)) store.put({ key, value: record.page, savedAt: record.savedAt ?? 0 });
            });
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
            tx.onerror = () => reject(tx.error);
          });
          localStorage.removeItem('wills-locadora.catalog-cache.v1');
        }
      } catch { /* Storage permissions may differ between APIs. */ }
      return db;
    } catch { return null; }
  })();
  return database;
}

async function read<T>(store: Store, key: string): Promise<T | null> {
  if (session[store].has(key)) return session[store].get(key) as T;
  try {
    const db = await openDatabase();
    if (!db) return null;
    const record = await request(db.transaction(store).objectStore(store).get(key));
    if (!record) return null;
    remember(store, key, record.value);
    return record.value as T;
  } catch { return null; }
}

async function write(store: Store, key: string, value: unknown): Promise<void> {
  remember(store, key, value);
  try {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const entries = tx.objectStore(store);
      entries.put({ key, value, savedAt: Date.now() });
      const count = entries.count();
      count.onsuccess = () => {
        let surplus = count.result - LIMITS[store];
        if (surplus <= 0) return;
        const cursor = entries.index('savedAt').openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result || surplus-- <= 0) return;
          cursor.result.delete();
          cursor.result.continue();
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* The bounded session cache remains usable if disk storage fails. */ }
}

function shelfKey(query: ShelfQuery): string {
  return JSON.stringify({ genres: [...query.genres].sort(), year: query.year, type: query.type, stand: query.stand, locale: query.locale });
}

export function readLocalShelf(query: ShelfQuery): Promise<ShelfPage | null> {
  return read('shelves', shelfKey(query));
}

export function cacheShelf(query: ShelfQuery, page: ShelfPage): Promise<void> {
  return write('shelves', shelfKey(query), page);
}

export function readLocalTitle(title: DiscoveryTitle, locale: ShelfQuery['locale']): Promise<DiscoveryTitle | null> {
  return read('titles', `${locale}:${title.identity.canonicalKey}`);
}

export function cacheTitle(title: DiscoveryTitle, locale: ShelfQuery['locale']): Promise<void> {
  return write('titles', `${locale}:${title.identity.canonicalKey}`, title);
}
