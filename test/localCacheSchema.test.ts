// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { normalizeDiscoveryTitle } from '../src/domain/content';

function createVersionOneDatabase(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('wills-locadora-catalogue', 1);
    opening.onupgradeneeded = () => {
      for (const name of ['shelves', 'titles']) {
        opening.result.createObjectStore(name, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
      }
    };
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('titles', 'readwrite');
      tx.objectStore('titles').put({ key, value, savedAt: Date.now() });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    opening.onerror = () => reject(opening.error);
  });
}

describe('local cache schema upgrade', () => {
  it('adds progress without invalidating the catalogue cache-key version', async () => {
    const title = normalizeDiscoveryTitle({ id: 603, type: 'movie', name: 'The Matrix', year: 1999 })!;
    const complete = { ...title, director: ['Lana Wachowski', 'Lilly Wachowski'] };
    await createVersionOneDatabase(`2:pt-BR:${title.identity.canonicalKey}`, complete);
    vi.resetModules();
    const cache = await import('../src/locadora/localCache');

    expect(await cache.readLocalTitle(title, 'pt-BR')).toEqual(complete);
    await cache.setEpisodeWatched('tt0133093', { season: 1, episode: 1 }, true);
    expect(await cache.readSeriesProgress('tt0133093')).toMatchObject({ season: 1, episode: 1 });
  });
});
