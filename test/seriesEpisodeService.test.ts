import { describe, expect, it } from 'vitest';
import { episodeListMessage, fetchSeriesEpisodes } from '../src/media/seriesEpisodeService';
import type { ConfiguredAddon } from '../src/platform/nativeBridge';

const streamOnly: ConfiguredAddon = { id: 'stream', name: 'Stream', resources: ['stream'], supportsStreams: true, supportsSubtitles: false };
const meta: ConfiguredAddon = { id: 'meta', name: 'Meta', resources: ['meta'], supportsStreams: false, supportsSubtitles: false };

describe('episode metadata fetch', () => {
  it('requests meta/series with the bare IMDb id from declared candidates', async () => {
    const calls: unknown[] = [];
    const result = await fetchSeriesEpisodes('tt0182576', [streamOnly, meta], async (request) => {
      calls.push(request);
      return { meta: { videos: [{ season: 1, episode: 1, title: 'Pilot' }] } };
    });
    expect(calls).toEqual([{ addonId: 'meta', resource: 'meta', contentType: 'series', id: 'tt0182576' }]);
    expect(result).toEqual({ status: 'available', episodes: { seasons: [{ season: 1, episodes: [{ season: 1, episode: 1, name: 'Pilot' }] }] } });
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
});
