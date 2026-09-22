import { describe, expect, it } from 'vitest';
import { byteUnits } from '../src/media/normalization';
import { MOVIE_QUICK_WATCH_V1, selectQuickWatch } from '../src/media/quickWatch';
import type { StreamCandidate } from '../src/media/types';

const { MEBIBYTE, GIBIBYTE } = byteUnits;

function candidate(
  stableId: string,
  resolution: 720 | 1080,
  sizeBytes: number,
  seeders: number,
  sourceName = 'Other',
): StreamCandidate {
  return {
    stableId,
    addonId: 'synthetic',
    sourceName,
    resolution,
    sizeBytes,
    seeders,
    transportType: 'http',
    displayName: stableId,
    playbackDescriptor: { kind: 'url', url: `https://example.invalid/${stableId}` },
    parseConfidence: 'complete',
    rejectionReasons: [],
  };
}

describe('movie Quick Watch v1', () => {
  it('prefers seeders over source inside the same tier', () => {
    const winner = selectQuickWatch('movie', [
      candidate('tpb', 1080, 1.2 * GIBIBYTE, 40, 'The Pirate Bay'),
      candidate('1337x', 1080, 1.4 * GIBIBYTE, 80, '1337x'),
    ]);
    expect(winner.winner?.stableId).toBe('1337x');
    expect(winner.tier).toBe(1);
  });

  it('keeps preferred-size 1080p above a larger release with more seeders', () => {
    const winner = selectQuickWatch('movie', [
      candidate('small', 1080, 1.8 * GIBIBYTE, 10),
      candidate('large', 1080, 3 * GIBIBYTE, 300),
    ]);
    expect(winner.winner?.stableId).toBe('small');
    expect(winner.reason).toBe('selected-preferred-1080p');
  });

  it('falls back to qualifying 720p when 1080p has only nine seeders', () => {
    const winner = selectQuickWatch('movie', [
      candidate('1080-weak', 1080, 1.5 * GIBIBYTE, 9),
      candidate('720-good', 720, 900 * MEBIBYTE, 10),
    ]);
    expect(winner.winner?.stableId).toBe('720-good');
    expect(winner.tier).toBe(3);
  });

  it('uses source, size, then stable ID as deterministic tie-breakers', () => {
    const sourceWinner = selectQuickWatch('movie', [
      candidate('rarbg', 1080, GIBIBYTE, 20, 'RARBG'),
      candidate('tpb', 1080, 1.5 * GIBIBYTE, 20, 'The Pirate Bay'),
    ]);
    expect(sourceWinner.winner?.stableId).toBe('tpb');

    const sizeWinner = selectQuickWatch('movie', [
      candidate('larger', 1080, 1.5 * GIBIBYTE, 20, 'RARBG'),
      candidate('smaller', 1080, GIBIBYTE, 20, 'RARBG'),
    ]);
    expect(sizeWinner.winner?.stableId).toBe('smaller');

    const stableWinner = selectQuickWatch('movie', [
      candidate('b', 1080, GIBIBYTE, 20),
      candidate('a', 1080, GIBIBYTE, 20),
    ]);
    expect(stableWinner.winner?.stableId).toBe('a');
  });

  it.each([
    [500 * MEBIBYTE, 1],
    [2 * GIBIBYTE, 1],
    [2 * GIBIBYTE + 1, 2],
    [5 * GIBIBYTE, 2],
  ])('includes exact size boundary %d in tier %d', (size, tier) => {
    expect(selectQuickWatch('movie', [candidate('boundary', 1080, size, 10)]).tier).toBe(tier);
  });

  it('does not autoplay candidates over 5 GB or weak 720p candidates', () => {
    const result = selectQuickWatch('movie', [
      candidate('too-large', 1080, 5 * GIBIBYTE + 1, 500),
      candidate('weak-720', 720, GIBIBYTE, 9),
    ]);
    expect(result.winner).toBeNull();
    expect(result.reason).toBe('no-candidate-met-autoplay-rules');
    expect(result.manualCandidateIds).toEqual(['too-large', 'weak-720']);
  });

  it('never applies movie rules to a series', () => {
    const result = selectQuickWatch('series', [candidate('episode', 1080, GIBIBYTE, 100)]);
    expect(result.winner).toBeNull();
    expect(result.reason).toBe('series-requires-manual-selection');
  });

  it('exposes a versioned declarative configuration', () => {
    expect(MOVIE_QUICK_WATCH_V1).toMatchObject({ version: 'movie-v1', minimumSeeders: 10 });
  });
});
