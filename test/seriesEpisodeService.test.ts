import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { cacheSeriesEpisodes, clearLocalCache, readLocalSeriesEpisodes } from '../src/locadora/localCache';
import { episodeListMessage, fetchSeriesEpisodes } from '../src/media/seriesEpisodeService';
import type { SeriesEpisodes } from '../src/media/seriesEpisodes';
import type { ConfiguredAddon } from '../src/platform/nativeBridge';

const streamOnly: ConfiguredAddon = { id: 'stream', name: 'Stream', resources: ['stream'], supportsStreams: true, supportsSubtitles: false };
const meta: ConfiguredAddon = { id: 'meta', name: 'Meta', resources: ['meta'], supportsStreams: false, supportsSubtitles: false };
const episodes: SeriesEpisodes = {
  seasons: [{ season: 1, episodes: [{ season: 1, episode: 1, name: 'Pilot' }] }],
};

beforeEach(async () => clearLocalCache());

describe('episode metadata fetch', () => {
  it('requests meta/series with the bare IMDb id from declared candidates', async () => {
    const calls: unknown[] = [];
    const result = await fetchSeriesEpisodes('tt0182576', [streamOnly, meta], async (request) => {
      calls.push(request);
      return { meta: { videos: [{ season: 1, episode: 1, title: 'Pilot' }] } };
    });
    expect(calls).toEqual([{ addonId: 'meta', resource: 'meta', contentType: 'series', id: 'tt0182576' }]);
    expect(result).toEqual({ status: 'available', episodes });
  });

  it('reuses the parsed episode list without a second add-on request', async () => {
    let requests = 0;
    const fetcher = async () => {
      requests += 1;
      return { meta: { videos: [{ season: 1, episode: 1, title: 'Pilot' }] } };
    };

    expect(await fetchSeriesEpisodes('tt0182576', [meta], fetcher)).toEqual({ status: 'available', episodes });
    expect(await fetchSeriesEpisodes('tt0182576', [meta], fetcher)).toEqual({ status: 'available', episodes });
    expect(requests).toBe(1);
  });

  it('tries another declared metadata source when the native capability check rejects one', async () => {
    const calls: string[] = [];
    const result = await fetchSeriesEpisodes('tt0182576', [meta, { ...meta, id: 'other' }], async (request) => {
      calls.push(request.addonId);
      if (request.addonId === 'meta') throw new Error('unsupported series prefix');
      return { meta: { videos: [{ season: 1, episode: 1 }] } };
    });
    expect(calls).toEqual(['meta', 'other']);
    expect(result.status).toBe('available');
  });

  it('provides typed, localized no-list states without leaking add-on failures', async () => {
    expect(await fetchSeriesEpisodes(null, [meta])).toEqual({ status: 'no-episode-list', reason: 'no-imdb-id' });
    expect(await fetchSeriesEpisodes('tt0182576', [streamOnly])).toEqual({ status: 'no-episode-list', reason: 'no-meta-addon' });
    expect(await fetchSeriesEpisodes('tt0182576', [meta], async () => { throw new Error('private details'); }))
      .toEqual({ status: 'no-episode-list', reason: 'addon-failure' });
    expect(await fetchSeriesEpisodes('tt0182576', [meta], async () => ({ meta: { videos: 'bad' } })))
      .toEqual({ status: 'no-episode-list', reason: 'malformed-payload' });
    expect(await fetchSeriesEpisodes('tt0182576', [meta], async () => ({ meta: { videos: [{ season: 'bad' }] } })))
      .toEqual({ status: 'no-episode-list', reason: 'malformed-payload' });
    expect(await fetchSeriesEpisodes('tt0182576', [meta], async () => ({ meta: { videos: [] } })))
      .toEqual({ status: 'no-episode-list', reason: 'empty-list' });
    expect(episodeListMessage('no-meta-addon', 'pt-BR')).toContain('Nenhuma fonte');
    expect(episodeListMessage('no-meta-addon', 'en-US')).toContain('No episode');
  });

  it('does not overwrite a good cached list when an in-flight fetch fails', async () => {
    const seriesId = 'tt9999903';
    let rejectFetch!: (reason: unknown) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = fetchSeriesEpisodes(seriesId, [meta], async () => {
      markStarted();
      return new Promise<never>((_resolve, reject) => { rejectFetch = reject; });
    });
    await started;
    await cacheSeriesEpisodes(seriesId, episodes);
    rejectFetch(new Error('private details'));

    expect(await pending).toEqual({ status: 'no-episode-list', reason: 'addon-failure' });
    expect(await readLocalSeriesEpisodes(seriesId)).toEqual(episodes);
  });
});
