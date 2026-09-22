import { describe, expect, it } from 'vitest';
import fixture from './fixtures/synthetic-addon-streams.json';
import { normalizeSourceName, normalizeStream, normalizeStreams } from '../src/media/normalization';

describe('stream normalization', () => {
  it('parses protocol-shaped Torrentio-style display metadata', () => {
    const [candidate] = normalizeStreams(fixture.streams, 'org.example.synthetic');
    expect(candidate).toMatchObject({
      addonId: 'org.example.synthetic',
      sourceName: 'YTS/YIFY',
      resolution: 1080,
      seeders: 80,
      transportType: 'http',
      parseConfidence: 'complete',
    });
    expect(candidate.sizeBytes).toBe(Math.round(1.4 * 1024 ** 3));
    expect(candidate.displayName).not.toContain('media.example.invalid');
  });

  it('prefers structured size and seeder fields', () => {
    const candidate = normalizeStream({
      name: 'Release 1080p TPB · 99 GB · Seeders: 1',
      infoHash: 'a'.repeat(40),
      behaviorHints: { videoSize: 700 * 1024 ** 2 },
      seeders: 34,
    }, 'addon');
    expect(candidate.sizeBytes).toBe(700 * 1024 ** 2);
    expect(candidate.seeders).toBe(34);
  });

  it('preserves bounded official torrent fields for Stremio Video', () => {
    const candidate = normalizeStream({
      name: 'Release 1080p 1 GB Seeders: 20',
      infoHash: 'A'.repeat(40),
      fileIdx: 3,
      sources: ['tracker:udp://tracker.example', '', 'x'.repeat(2_049)],
    }, 'addon');
    expect(candidate.playbackDescriptor).toEqual({
      kind: 'torrent',
      infoHash: 'a'.repeat(40),
      fileIndex: 3,
      announce: ['tracker:udp://tracker.example'],
    });
  });

  it('leaves ambiguous candidates available but not autoplay-safe', () => {
    const candidate = normalizeStream({ name: 'Mystery release', url: 'https://example.invalid/video' }, 'addon');
    expect(candidate.parseConfidence).toBe('partial');
    expect(candidate.rejectionReasons).toEqual(expect.arrayContaining([
      'unsupported-or-unknown-resolution',
      'unknown-size',
      'unknown-seeders',
    ]));
  });

  it.each([
    ['TPB', 'The Pirate Bay'],
    ['The Pirate Bay', 'The Pirate Bay'],
    ['RARBG', 'RARBG'],
    ['YTS', 'YTS/YIFY'],
    ['YIFY', 'YTS/YIFY'],
    ['ytfs', 'YTS/YIFY'],
    ['1337x', '1337x'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSourceName('', input)).toBe(expected);
  });

  it('does not accept privileged local-file playback', () => {
    const candidate = normalizeStream({ name: '1080p 1 GB Seeders: 20', url: 'file:///home/user/video.mkv' }, 'addon');
    expect(candidate.transportType).toBe('unsupported');
  });
});
