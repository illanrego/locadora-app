import { describe, expect, it } from 'vitest';
import { externalId, normalizeDiscoveryTitle } from '../src/domain/content';

describe('normalizeDiscoveryTitle', () => {
  it('bridges TMDB and confirmed IMDb identities without using either as an internal field', () => {
    const title = normalizeDiscoveryTitle({
      id: 'tmdb:42',
      imdbId: 'tt1234567',
      type: 'movie',
      name: 'Example title',
      year: 1999,
      genres: ['Drama'],
      poster: 'https://images.example.invalid/poster.jpg',
    });

    expect(title?.identity.canonicalKey).toBe('movie:tmdb:42');
    expect(externalId(title!.identity, 'tmdb')).toBe('42');
    expect(externalId(title!.identity, 'imdb')).toBe('tt1234567');
  });

  it('rejects malformed records and non-web poster schemes', () => {
    expect(normalizeDiscoveryTitle({ id: 1, name: 'Missing type' })).toBeNull();
    expect(normalizeDiscoveryTitle({ id: 1, type: 'movie', name: 'Unsafe', poster: 'file:///secret' })?.posterUrl).toBeNull();
  });
});
