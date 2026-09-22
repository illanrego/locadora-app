import { describe, expect, it } from 'vitest';
import { normalizeDiscoveryTitle } from '../src/domain/content';
import { resolveTitleMedia, type ConfiguredResourceFetcher } from '../src/media/resolutionService';
import type { ConfiguredAddon } from '../src/platform/nativeBridge';

const title = normalizeDiscoveryTitle({
  id: 1,
  imdbId: 'tt1254207',
  type: 'movie',
  name: 'Public-domain fixture',
  year: 2008,
})!;

const addons: ConfiguredAddon[] = [
  { id: 'good', name: 'Good fixture', supportsStreams: true, supportsSubtitles: false },
  { id: 'broken', name: 'Broken fixture', supportsStreams: true, supportsSubtitles: false },
];

describe('configured media resolution', () => {
  it('aggregates add-ons, redacts failures, normalizes candidates, and explains its winner', async () => {
    const fetcher: ConfiguredResourceFetcher = async ({ addonId }) => {
      if (addonId === 'broken') throw new Error('failed https://secret.example/manifest.json?token=never-show');
      return {
        streams: [
          { name: '1080p', title: 'YTS · 1.4 GB · 👤 80', url: 'https://media.example.invalid/video.mp4?token=secret' },
          { name: '720p', title: 'TPB · 900 MB · Seeders: 200', infoHash: 'a'.repeat(40) },
        ],
      };
    };
    const result = await resolveTitleMedia(title, addons, { fetcher });
    expect(result.status).toBe('resolved');
    expect(result.quickWatch?.winner).toMatchObject({ addonId: 'good', resolution: 1080 });
    expect(result.diagnostics).toEqual([
      { addonId: 'good', outcome: 'fulfilled', candidateCount: 2, message: null },
      { addonId: 'broken', outcome: 'failed', candidateCount: 0, message: 'failed [REDACTED_URL]' },
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain('never-show');
  });

  it('requires the manual picker for series regardless of candidate quality', async () => {
    const series = normalizeDiscoveryTitle({ id: 2, imdbId: 'tt0903747', type: 'series', name: 'Series', year: 2008 })!;
    const fetcher: ConfiguredResourceFetcher = async () => ({
      streams: [{ name: '1080p 1 GB Seeders: 100', url: 'https://media.example.invalid/episode.mp4' }],
    });
    const result = await resolveTitleMedia(series, addons.slice(0, 1), { fetcher });
    expect(result.status).toBe('manual-selection-required');
    expect(result.quickWatch?.reason).toBe('series-requires-manual-selection');
    expect(result.manualCandidates).toHaveLength(1);
  });

  it('does not query add-ons without a confirmed IMDb identity', async () => {
    const unmapped = normalizeDiscoveryTitle({ id: 3, type: 'movie', name: 'Unmapped', year: 2000 })!;
    let called = false;
    const fetcher: ConfiguredResourceFetcher = async () => { called = true; return { streams: [] }; };
    const result = await resolveTitleMedia(unmapped, addons, { fetcher });
    expect(result.status).toBe('identity-unmapped');
    expect(called).toBe(false);
  });

  it('honors cancellation before and after bounded native requests', async () => {
    const before = new AbortController();
    before.abort();
    await expect(resolveTitleMedia(title, addons, { signal: before.signal })).resolves.toMatchObject({ status: 'cancelled' });

    const after = new AbortController();
    const fetcher: ConfiguredResourceFetcher = async () => {
      after.abort();
      return { streams: [] };
    };
    await expect(resolveTitleMedia(title, addons.slice(0, 1), { signal: after.signal, fetcher })).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('distinguishes no configuration from no returned sources', async () => {
    await expect(resolveTitleMedia(title, [])).resolves.toMatchObject({ status: 'no-configured-stream-addons' });
    const fetcher: ConfiguredResourceFetcher = async () => ({ streams: [] });
    await expect(resolveTitleMedia(title, addons.slice(0, 1), { fetcher })).resolves.toMatchObject({ status: 'no-sources' });
  });
});
