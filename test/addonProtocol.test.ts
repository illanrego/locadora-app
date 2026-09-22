import { describe, expect, it, vi } from 'vitest';
import {
  buildResourceUrl,
  connectAddon,
  requestStreams,
  supportsResource,
  validateManifestUrl,
} from '../src/media/addonProtocol';
import type { AddonManifest } from '../src/media/types';

const manifest: AddonManifest = {
  id: 'org.example.safe',
  name: 'Synthetic fixture add-on',
  version: '1.0.0',
  types: ['movie', 'series'],
  resources: [{ name: 'stream', types: ['movie'], idPrefixes: ['tt'] }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('add-on protocol client', () => {
  it('accepts HTTPS manifest paths and builds encoded protocol resource URLs', () => {
    expect(validateManifestUrl('https://addon.example.invalid/user-config/manifest.json').protocol).toBe('https:');
    expect(buildResourceUrl(
      'https://addon.example.invalid/user-config/manifest.json?token=secret',
      'stream',
      'movie',
      'tt12:3',
    )).toBe('https://addon.example.invalid/user-config/stream/movie/tt12%3A3.json');
  });

  it.each([
    'http://addon.example.invalid/manifest.json',
    'https://localhost/manifest.json',
    'https://127.0.0.1/manifest.json',
    'https://user:pass@addon.example.invalid/manifest.json',
    'https://addon.example.invalid/not-a-manifest',
  ])('rejects unsafe manifest URL %s', (url) => {
    expect(() => validateManifestUrl(url)).toThrow();
  });

  it('filters add-ons by resource, type, and ID prefix', () => {
    expect(supportsResource(manifest, 'stream', 'movie', 'tt1254207')).toBe(true);
    expect(supportsResource(manifest, 'stream', 'series', 'tt1254207')).toBe(false);
    expect(supportsResource(manifest, 'stream', 'movie', 'custom:1')).toBe(false);
    expect(supportsResource(manifest, 'subtitles', 'movie', 'tt1254207')).toBe(false);
  });

  it('loads and validates a bounded manifest without exposing its URL in errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(manifest));
    const connection = await connectAddon('https://addon.example.invalid/private/manifest.json?token=never-log', { fetchImpl });
    expect(connection.manifest.id).toBe(manifest.id);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('requests streams only from compatible add-ons', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ streams: [{ name: 'Example' }] }));
    const connection = { manifest, manifestUrl: 'https://addon.example.invalid/manifest.json' };
    await expect(requestStreams(connection, { type: 'movie', videoId: 'tt1254207' }, { fetchImpl }))
      .resolves.toEqual([{ name: 'Example' }]);
    await expect(requestStreams(connection, { type: 'series', videoId: 'tt1254207' }, { fetchImpl }))
      .resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects oversized bodies before parsing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', {
      headers: { 'content-length': String(2 * 1024 * 1024) },
    }));
    await expect(connectAddon('https://addon.example.invalid/manifest.json', { fetchImpl }))
      .rejects.toThrow('too large');
  });
});
