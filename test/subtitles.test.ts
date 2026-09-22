import { describe, expect, it } from 'vitest';
import {
  groupSubtitleTracks,
  normalizeSubtitleLanguage,
  normalizeSubtitleTracks,
  subtitleDelayFingerprint,
} from '../src/media/subtitles';

describe('subtitle normalization', () => {
  it.each([
    ['pt-BR', 'pt-BR'],
    ['pob', 'pt-BR'],
    ['por', 'pt'],
    ['pt_PT', 'pt-PT'],
    ['eng', 'en'],
    ['en', 'en'],
    ['spa', 'other'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(normalizeSubtitleLanguage(input)).toBe(expected);
  });

  it('puts Portuguese and English first without discarding other languages', () => {
    const tracks = normalizeSubtitleTracks([
      { id: 'es', lang: 'spa', label: 'Español', url: 'https://example.invalid/es.srt' },
      { id: 'en', lang: 'eng', label: 'English [CC]', url: 'https://example.invalid/en.srt' },
      { id: 'pt', lang: 'pob', label: 'Português Brasil', url: 'https://example.invalid/pt.srt' },
    ]);
    const groups = groupSubtitleTracks(tracks);
    expect(groups.preferred.map((track) => track.id)).toEqual(['pt', 'en']);
    expect(groups.other.map((track) => track.id)).toEqual(['es']);
  });

  it('scopes remembered delay to both video and subtitle identity', () => {
    const first = subtitleDelayFingerprint('video-a', { id: 'pt' });
    expect(subtitleDelayFingerprint('video-a', { id: 'pt' })).toBe(first);
    expect(subtitleDelayFingerprint('video-b', { id: 'pt' })).not.toBe(first);
    expect(subtitleDelayFingerprint('video-a', { id: 'en' })).not.toBe(first);
  });
});
