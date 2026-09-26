// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { readSubtitleDelay, writeSubtitleDelay, videoDelayIdentity } from '../src/media/subtitleDelayStore';
import { normalizeStream } from '../src/media/normalization';

beforeEach(() => window.localStorage.clear());

describe('release-scoped subtitle delay storage', () => {
  it('does not leak delay between releases or tracks', () => {
    writeSubtitleDelay('release-a', 'pt', 1_500);
    expect(readSubtitleDelay('release-a', 'pt')).toBe(1_500);
    expect(readSubtitleDelay('release-b', 'pt')).toBe(0);
    expect(readSubtitleDelay('release-a', 'en')).toBe(0);
  });

  it('bounds corrupted and excessive values', () => {
    writeSubtitleDelay('release', 'pt', 900_000);
    expect(readSubtitleDelay('release', 'pt')).toBe(600_000);
  });

  it('keeps delay identity stable when source order or seeder labels change', () => {
    const infoHash = 'a'.repeat(40);
    const first = normalizeStream({ infoHash, fileIdx: 0, title: '1080p 10 seeders' }, 'test', 0);
    const reordered = normalizeStream({ infoHash, fileIdx: 0, title: '1080p 20 seeders' }, 'test', 7);
    const differentFile = normalizeStream({ infoHash, fileIdx: 1 }, 'test');
    expect(videoDelayIdentity(first)).toBe(videoDelayIdentity(reordered));
    expect(videoDelayIdentity(first)).not.toBe(videoDelayIdentity(differentFile));
    expect(videoDelayIdentity(normalizeStream({ infoHash }, 'test'))).toBeNull();
  });
});
