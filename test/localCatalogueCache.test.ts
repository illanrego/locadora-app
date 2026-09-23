// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('local catalogue cache', () => {
  it('restores a shelf page and its artwork URLs without a network request', () => {
    const page = { titles: [title], hasNextStand: true, source: 'public-api' as const };
    cacheShelf(query, page);

    expect(readLocalShelf(query)).toEqual(page);
  });

  it('only treats a full inspection record as title detail cache', () => {
    cacheShelf(query, { titles: [title], hasNextStand: false, source: 'public-api' });
    expect(readLocalTitle(title)).toBeNull();

    const complete = { ...title, director: ['Lana Wachowski', 'Lilly Wachowski'] };
    cacheTitle(complete);
    expect(readLocalTitle(title)).toEqual(complete);

    cacheShelf(query, { titles: [title], hasNextStand: false, source: 'public-api' });
    expect(readLocalTitle(title)).toEqual(complete);
  });
});
