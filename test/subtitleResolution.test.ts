import { describe, expect, it } from 'vitest';
import { normalizeDiscoveryTitle } from '../src/domain/content';
import { resolveTitleSubtitles } from '../src/media/subtitleResolution';
import type { ConfiguredAddon } from '../src/platform/nativeBridge';

const movie = normalizeDiscoveryTitle({
  id: 1,
  imdbId: 'tt1254207',
  type: 'movie',
  name: 'Fixture',
  year: 2008,
})!;
const addons: ConfiguredAddon[] = [{
  id: 'subtitles',
  name: 'Subtitle fixture',
  supportsStreams: false,
  supportsSubtitles: true,
}];

describe('official Core subtitle resource resolution', () => {
  it('normalizes bounded tracks for the official Stremio Video command', async () => {
    const tracks = await resolveTitleSubtitles(movie, addons, {
      fetcher: async (request) => {
        expect(request).toMatchObject({ resource: 'subtitles', contentType: 'movie', id: 'tt1254207' });
        return { subtitles: [
          { id: 'pt', lang: 'pob', label: 'Português', url: 'https://subs.example/pt.srt?token=private' },
          { id: 'unsafe', lang: 'en', url: 'file:///etc/passwd' },
        ] };
      },
    });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      lang: 'pt-BR',
      label: 'Português',
      origin: 'Subtitle fixture',
      embedded: false,
    });
    expect(tracks[0].id).not.toContain('private');
  });

  it('does not guess an episode subtitle identity for series', async () => {
    const series = normalizeDiscoveryTitle({ id: 2, imdbId: 'tt0903747', type: 'series', name: 'Series' })!;
    let called = false;
    const tracks = await resolveTitleSubtitles(series, addons, {
      fetcher: async () => { called = true; return { subtitles: [] }; },
    });
    expect(tracks).toEqual([]);
    expect(called).toBe(false);
  });
});
