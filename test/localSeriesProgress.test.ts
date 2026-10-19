// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllSeriesProgress,
  clearLocalCache,
  clearSeriesProgress,
  readAllSeriesProgress,
  readSeriesProgress,
  setEpisodeWatched,
  setSeasonWatched,
  writeAllSeriesProgress,
  writeSeriesProgress,
} from '../src/locadora/localCache';

const seriesId = 'tt0182576';

beforeEach(async () => {
  await clearLocalCache();
});

describe('local series progress', () => {
  it('persists progress in IndexedDB across a module remount', async () => {
    await setEpisodeWatched(seriesId, { season: 16, episode: 5 }, true, new Date('2026-10-18T12:00:00.000Z'));
    vi.resetModules();
    const restored = await import('../src/locadora/localCache');

    expect(await restored.readSeriesProgress(seriesId)).toEqual({
      seriesId,
      season: 16,
      episode: 5,
      watched: { '16:5': '2026-10-18T12:00:00.000Z' },
      updatedAt: '2026-10-18T12:00:00.000Z',
    });
  });

  it('prunes the oldest watched entries and supports one-series and all-series operations', async () => {
    const watched = Object.fromEntries(Array.from({ length: 502 }, (_, index) => [
      `1:${index + 1}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    ]));
    await writeSeriesProgress({
      seriesId,
      season: 1,
      episode: 502,
      watched,
      updatedAt: '2026-10-18T12:00:00.000Z',
    });
    const stored = await readSeriesProgress(seriesId);
    expect(Object.keys(stored?.watched ?? {})).toHaveLength(500);
    expect(stored?.watched).not.toHaveProperty('1:1');
    expect(stored?.watched).not.toHaveProperty('1:2');
    expect(await readAllSeriesProgress()).toHaveLength(1);

    await clearSeriesProgress(seriesId);
    expect(await readSeriesProgress(seriesId)).toBeNull();
    await writeAllSeriesProgress([{
      seriesId, season: 1, episode: 1,
      watched: { '1:1': '2026-10-18T12:00:00.000Z' }, updatedAt: '2026-10-18T12:00:00.000Z',
    }]);
    expect(await readAllSeriesProgress()).toHaveLength(1);
    await clearAllSeriesProgress();
    expect(await readAllSeriesProgress()).toEqual([]);
  });

  it('clears progress through the canonical local-cache clear path', async () => {
    await setEpisodeWatched(seriesId, { season: 1, episode: 1 }, true);
    await clearLocalCache();
    expect(await readSeriesProgress(seriesId)).toBeNull();
  });

  it('writes one record for a whole season and removes the same records on unmark', async () => {
    const first = new Date('2026-10-19T12:00:00.000Z');
    const second = new Date('2026-10-19T13:00:00.000Z');
    const seasonTwo = [1, 2, 3].map((episode) => ({ season: 2, episode }));
    await setEpisodeWatched(seriesId, { season: 1, episode: 9 }, true, first);

    const marked = await setSeasonWatched(seriesId, 2, seasonTwo, true, second);
    expect(marked).toEqual({
      seriesId,
      season: 2,
      episode: 3,
      watched: {
        '2:1': '2026-10-19T13:00:00.000Z',
        '2:2': '2026-10-19T13:00:00.000Z',
        '2:3': '2026-10-19T13:00:00.000Z',
        '1:9': '2026-10-19T12:00:00.000Z',
      },
      updatedAt: '2026-10-19T13:00:00.000Z',
    });
    // One stored record, not one per episode.
    expect(await readAllSeriesProgress()).toHaveLength(1);
    expect(await readSeriesProgress(seriesId)).toEqual(marked);

    const unmarked = await setSeasonWatched(seriesId, 2, [...seasonTwo].reverse(), false, second);
    expect(Object.keys(unmarked?.watched ?? {})).toEqual(['1:9']);
    expect(unmarked).toMatchObject({ season: 2, episode: 1 });
    expect(await readAllSeriesProgress()).toHaveLength(1);
  });

  it('refuses a season write that mixes seasons or has no episodes', async () => {
    await expect(setSeasonWatched(seriesId, 2, [{ season: 1, episode: 1 }], true)).resolves.toBeNull();
    await expect(setSeasonWatched(seriesId, 2, [], true)).resolves.toBeNull();
    // Season 0 (specials) is outside the progress key grammar.
    await expect(setSeasonWatched(seriesId, 0, [{ season: 0, episode: 1 }], true)).resolves.toBeNull();
    await expect(setSeasonWatched('not-an-id', 2, [{ season: 2, episode: 1 }], true)).resolves.toBeNull();
    expect(await readSeriesProgress(seriesId)).toBeNull();
  });
});
