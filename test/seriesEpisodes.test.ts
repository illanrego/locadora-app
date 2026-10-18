import { describe, expect, it } from 'vitest';
import { episodeVideoId, episodesForSeason, nextEpisode, parseSeriesEpisodes, shouldMarkEpisodeWatched } from '../src/media/seriesEpisodes';

const sample = parseSeriesEpisodes({ meta: { videos: [
  { season: 2, episode: 2, title: 'Second', released: '2020-02-29T00:00:00.000Z' },
  { season: 1, episode: 2, name: 'After a gap' },
  { season: 2, episode: 1, title: 'Boundary' },
  { season: 0, episode: 1, title: 'Special' },
  { season: 1, episode: 1, name: 'Start' },
] } });

describe('series episodes', () => {
  it('normalizes sorted seasons, specials, names, dates and drops duplicate or malformed entries', () => {
    const result = parseSeriesEpisodes({ meta: { videos: [
      { season: 1, episode: 2, name: 'A'.repeat(130), released: '2020-02-30' },
      { season: 1, episode: 2, name: 'Duplicate' },
      { season: 0, episode: 3, title: 'Special', released: '2020-02-29T00:00:00Z' },
      { season: 1, title: 'Missing episode' },
      { episode: 1, title: 'Missing season' },
      { season: '1', episode: 3 },
      { season: -1, episode: 4 },
      { season: 1, episode: 0 },
      { season: 1.2, episode: 4 },
    ] } });
    expect(result.seasons.map((season) => season.season)).toEqual([0, 1]);
    expect(episodesForSeason(result, 1)).toEqual([{ season: 1, episode: 2, name: 'A'.repeat(120) }]);
    expect(episodesForSeason(result, 0)).toEqual([{ season: 0, episode: 3, name: 'Special', released: '2020-02-29' }]);
    expect(episodesForSeason(result, 9)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('Missing');
  });

  it('returns an empty shape for malformed payloads', () => {
    for (const payload of [null, [], {}, { meta: null }, { meta: { videos: {} } }]) {
      expect(parseSeriesEpisodes(payload)).toEqual({ seasons: [] });
    }
  });

  it('limits seasons and episodes across oversized metadata', () => {
    const videos = Array.from({ length: 500 }, (_, i) => ({ season: Math.floor(i / 10) + 1, episode: i % 10 + 1 }));
    const result = parseSeriesEpisodes({ meta: { videos } });
    expect(result.seasons).toHaveLength(30);
    expect(result.seasons.flatMap((season) => season.episodes)).toHaveLength(300);
    const sparse = parseSeriesEpisodes({ meta: { videos: Array.from({ length: 50 }, (_, i) => ({ season: i + 1, episode: 1 })) } });
    expect(sparse.seasons).toHaveLength(40);
  });

  it('finds the first unwatched normal episode with no resume pointer', () => {
    expect(nextEpisode(sample, new Set())).toMatchObject({ season: 1, episode: 1 });
    expect(nextEpisode(sample, new Set(['1:1', '1:2', '2:1', '2:2']))).toBeNull();
  });

  it('resumes at or after a mid-season pointer and ignores earlier watched gaps', () => {
    expect(nextEpisode(sample, new Set(['2:1']), { season: 2, episode: 1 })).toMatchObject({ season: 2, episode: 2 });
    expect(nextEpisode(sample, new Set(['1:1', '2:1', '2:2']))).toMatchObject({ season: 1, episode: 2 });
    expect(nextEpisode(sample, new Set(['1:1', '2:1']), { season: 2, episode: 1 })).toMatchObject({ season: 2, episode: 2 });
  });

  it('crosses a season boundary and returns null for a pointer past the end', () => {
    expect(nextEpisode(sample, new Set(['1:2']), { season: 1, episode: 2 })).toMatchObject({ season: 2, episode: 1 });
    expect(nextEpisode(sample, new Set(), { season: 3, episode: 1 })).toBeNull();
  });

  it.each([
    [{ time: 89_000, duration: 100_000, ended: false }, false],
    [{ time: 90_000, duration: 100_000, ended: false }, true],
    [{ time: null, duration: null, ended: true }, true],
  ] as const)('applies the watched threshold to %o', (state, expected) => {
    expect(shouldMarkEpisodeWatched(state)).toBe(expected);
  });

  it('composes only bounded episode ids with a confirmed series IMDb id', () => {
    expect(episodeVideoId('tt0182576', { season: 16, episode: 5 })).toBe('tt0182576:16:5');
    expect(episodeVideoId('tt0182576', { season: 0, episode: 1 })).toBe('tt0182576:0:1');
    for (const id of ['tt1234', 'tt1234567890', 'abc12345']) {
      expect(() => episodeVideoId(id, { season: 1, episode: 1 })).toThrow();
    }
    for (const episode of [{ season: -1, episode: 1 }, { season: 1, episode: 0 }, { season: 1.2, episode: 3 }, { season: Infinity, episode: 1 }]) {
      expect(() => episodeVideoId('tt0182576', episode)).toThrow();
    }
  });
});
