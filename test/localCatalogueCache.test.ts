// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeDiscoveryTitle } from '../src/domain/content';
import { cacheShelf, cacheTitle, readLocalShelf, readLocalTitle } from '../src/locadora/localCache';

afterEach(() => window.localStorage.clear());

const title = normalizeDiscoveryTitle({
  id: 603,
  imdbId: 'tt0133093',
  type: 'movie',
  name: 'The Matrix',
  year: 1999,
  genres: ['Action', 'Science Fiction'],
  poster: 'https://images.example.invalid/matrix.jpg',
})!;

const query = {
  genres: ['Action'],
  year: 1999,
  type: 'movie' as const,
  stand: 0,
  locale: 'pt-BR' as const,
};

function writeRawTitleRecord(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('wills-locadora-catalogue', 2);
    opening.onupgradeneeded = () => {
      for (const name of ['shelves', 'titles']) {
        if (!opening.result.objectStoreNames.contains(name)) {
          opening.result.createObjectStore(name, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
        }
      }
      if (!opening.result.objectStoreNames.contains('progress')) opening.result.createObjectStore('progress', { keyPath: 'key' });
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

describe('local catalogue cache', () => {
  it('restores a shelf page and its artwork URLs without a network request', async () => {
    const page = { titles: [title], hasNextStand: true, source: 'public-api' as const };
    await cacheShelf(query, page);

    expect(await readLocalShelf(query)).toEqual(page);
    vi.resetModules();
    const restored = await import('../src/locadora/localCache');
    expect(await restored.readLocalShelf(query)).toEqual(page);
  });

  it('only treats a full inspection record as title detail cache and isolates languages', async () => {
    await cacheShelf(query, { titles: [title], hasNextStand: false, source: 'public-api' });
    expect(await readLocalTitle(title, 'pt-BR')).toBeNull();

    const complete = { ...title, director: ['Lana Wachowski', 'Lilly Wachowski'] };
    await cacheTitle(complete, 'pt-BR');
    expect(await readLocalTitle(title, 'pt-BR')).toEqual(complete);
    expect(await readLocalTitle(title, 'en-US')).toBeNull();
    await cacheTitle({ ...complete, description: 'English synopsis' }, 'en-US');
    expect((await readLocalTitle(title, 'en-US'))?.description).toBe('English synopsis');

    await cacheShelf(query, { titles: [title], hasNextStand: false, source: 'public-api' });
    expect(await readLocalTitle(title, 'pt-BR')).toEqual(complete);
  });

  it('ignores title records written by an earlier cache version', async () => {
    // A tape inspected before the credits block existed was stored under the unversioned key; it must
    // not be served now, otherwise its person names can never become clickable.
    const legacyTitle = normalizeDiscoveryTitle({ id: 424242, type: 'movie', name: 'Legacy Tape', year: 1971, genres: ['Drama'] })!;
    const legacy = { ...legacyTitle, director: ['Some Director'] };
    await writeRawTitleRecord(`pt-BR:${legacyTitle.identity.canonicalKey}`, legacy);

    expect(await readLocalTitle(legacyTitle, 'pt-BR')).toBeNull();

    await cacheTitle(legacy, 'pt-BR');
    expect(await readLocalTitle(legacyTitle, 'pt-BR')).toEqual(legacy);
  });
});
