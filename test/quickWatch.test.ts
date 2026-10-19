import { describe, expect, it } from 'vitest';
import { byteUnits, normalizeStream } from '../src/media/normalization';
import { MOVIE_QUICK_WATCH_V1, SERIES_QUICK_WATCH_V1, selectQuickWatch } from '../src/media/quickWatch';
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
    transportType: 'torrent',
    displayName: stableId,
    playbackDescriptor: { kind: 'torrent', infoHash: 'a'.repeat(40), fileIndex: 0, announce: [] },
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
    const result = selectQuickWatch('series', [candidate('episode', 1080, 2 * GIBIBYTE, 100)]);
    expect(result.winner).toBeNull();
    expect(result.reason).toBe('series-requires-manual-selection');
  });

  it('exposes a versioned declarative configuration', () => {
    expect(MOVIE_QUICK_WATCH_V1).toMatchObject({ version: 'movie-v1', minimumSeeders: 10 });
  });
});


const episodeBoundaries: Array<[string, number, 1 | 2 | null, 1 | null]> = [
  ['99 MB', 99 * MEBIBYTE, null, null],
  ['100 MB', 100 * MEBIBYTE, 1, null],
  ['500 MB', 500 * MEBIBYTE, 1, 1],
  ['500 MB + 1 byte', 500 * MEBIBYTE + 1, 2, 1],
  ['501 MB', 501 * MEBIBYTE, 2, 1],
  ['1 GB', GIBIBYTE, 2, 1],
  ['1 GB + 1 byte', GIBIBYTE + 1, null, 1],
];

describe('series Quick Watch v1', () => {
  it('keeps the existing config shape and source order with episode values', () => {
    expect(SERIES_QUICK_WATCH_V1).toEqual({
      ...MOVIE_QUICK_WATCH_V1, version: 'series-v1', minimumSeeders: 20,
      preferredMinimumBytes: 100 * MEBIBYTE,
      preferredMaximumBytes: 500 * MEBIBYTE, maximumBytes: GIBIBYTE,
    });
  });

  it.each(episodeBoundaries)('checks %s for episodes and unchanged movie rules', (_, size, tier, movieTier) => {
    const fixtures = [candidate('boundary', 1080, size, 20, 'The Pirate Bay')];
    expect(selectQuickWatch('series', fixtures)).toMatchObject({
      rulesVersion: 'series-v1', tier,
      winner: tier ? { stableId: 'boundary' } : null,
      reason: tier === 1 ? 'selected-preferred-1080p'
        : tier === 2 ? 'selected-larger-1080p' : 'series-requires-manual-selection',
      manualCandidateIds: ['boundary'],
    });
    expect(selectQuickWatch('movie', fixtures, MOVIE_QUICK_WATCH_V1)).toMatchObject({
      rulesVersion: 'movie-v1', tier: movieTier,
      winner: movieTier ? { stableId: 'boundary' } : null,
    });
  });

  it.each(episodeBoundaries)('enforces %s at 720p too', (_, size, tier) => {
    const fixtures = [candidate('fallback', 720, size, 20)];
    expect(selectQuickWatch('series', fixtures)).toMatchObject({
      tier: tier ? 3 : null, winner: tier ? { stableId: 'fallback' } : null,
    });
  });

  it.each([720, 1080] as const)('rejects multi-GB season packs at %dp, even with a movie config', (resolution) => {
    const fixtures = [candidate('season-pack', resolution, 3 * GIBIBYTE, 500)];
    expect(selectQuickWatch('series', fixtures, MOVIE_QUICK_WATCH_V1)).toMatchObject({
      rulesVersion: 'series-v1', winner: null, reason: 'series-requires-manual-selection',
      manualCandidateIds: ['season-pack'],
    });
    expect(selectQuickWatch('movie', fixtures).winner?.stableId).toBe('season-pack');
  });

  it.each([19, 20])('requires 20 seeders, received %d', (seeders) => {
    for (const resolution of [720, 1080] as const) {
      const fixtures = [candidate('episode', resolution, 500 * MEBIBYTE, seeders)];
      expect(selectQuickWatch('series', fixtures).winner?.stableId).toBe(seeders === 20 ? 'episode' : undefined);
      expect(selectQuickWatch('movie', fixtures).winner?.stableId).toBe('episode');
    }
  });

  it.each([
    ['preferred', 1080, 300 * MEBIBYTE, 1080, 700 * MEBIBYTE, 1],
    ['larger before 720p', 1080, 700 * MEBIBYTE, 720, 300 * MEBIBYTE, 2],
    ['720p preferred bucket', 720, 300 * MEBIBYTE, 720, 700 * MEBIBYTE, 3],
  ] as const)('keeps the ladder: %s', (_, resolution, size, lowerResolution, lowerSize, tier) => {
    const result = selectQuickWatch('series', [
      candidate('lower', lowerResolution, lowerSize, 500, 'The Pirate Bay'),
      candidate('winner', resolution, size, 20, 'RARBG'),
    ]);
    expect(result).toMatchObject({ tier, winner: { stableId: 'winner' } });
  });

  it('falls back to 720p when 1080p has only 19 seeders', () => {
    const fixtures = [candidate('weak', 1080, 500 * MEBIBYTE, 19),
      candidate('fallback', 720, 500 * MEBIBYTE, 20)];
    expect(selectQuickWatch('series', fixtures)).toMatchObject({ tier: 3, winner: { stableId: 'fallback' } });
    expect(selectQuickWatch('movie', fixtures).winner?.stableId).toBe('weak');
  });

  it.each(['Other', '', '   '])('ranks unnamed %j after every named source regardless of seeders', (unnamed) => {
    for (const name of [...SERIES_QUICK_WATCH_V1.sourceOrder, 'EZTV', 'UnlistedSource']) {
      for (const resolution of [720, 1080] as const) {
        const fixtures = [candidate('unnamed', resolution, 500 * MEBIBYTE, 1_000_000, unnamed),
          candidate('named', resolution, 500 * MEBIBYTE, 20, name)];
        expect(selectQuickWatch('series', fixtures).winner?.stableId).toBe('named');
        expect(selectQuickWatch('movie', fixtures).winner?.stableId).toBe('unnamed');
      }
    }
  });

  it.each([
    ['seeders', candidate('winner', 1080, 500 * MEBIBYTE, 21, 'UnlistedSource'),
      candidate('loser', 1080, 500 * MEBIBYTE, 20, 'The Pirate Bay')],
    ['source', candidate('winner', 1080, 500 * MEBIBYTE, 20, 'The Pirate Bay'),
      candidate('loser', 1080, 500 * MEBIBYTE, 20, 'RARBG')],
    ['size', candidate('winner', 1080, 600 * MEBIBYTE, 20, 'RARBG'),
      candidate('loser', 1080, 700 * MEBIBYTE, 20, 'RARBG')],
    ['stable id', candidate('a', 1080, 500 * MEBIBYTE, 20, 'RARBG'),
      candidate('b', 1080, 500 * MEBIBYTE, 20, 'RARBG')],
  ])('keeps the %s tie-break deterministic under shuffled input', (_, winner, loser) => {
    const extra = candidate('pack', 1080, 3 * GIBIBYTE, 500);
    for (const order of [[winner, loser, extra], [winner, extra, loser], [loser, winner, extra],
      [loser, extra, winner], [extra, winner, loser], [extra, loser, winner]]) {
      expect(selectQuickWatch('series', order).winner?.stableId).toBe(winner.stableId);
      expect(selectQuickWatch('movie', order).winner?.stableId).toBe(winner.stableId);
    }
  });

  it('keeps unsafe or incomplete candidates manual', () => {
    for (const override of [{ parseConfidence: 'partial' as const }, { sizeBytes: null },
      { seeders: null }, { transportType: 'external' as const }, { transportType: 'unsupported' as const }]) {
      const result = selectQuickWatch('series', [{ ...candidate('unsafe', 1080, 300 * MEBIBYTE, 50), ...override }]);
      expect(result).toMatchObject({ winner: null, reason: 'series-requires-manual-selection', rulesVersion: 'series-v1' });
    }
    expect(selectQuickWatch('series', []).reason).toBe('series-requires-manual-selection');
  });

  it('recognizes Torrentio TPB display text and wins the source tie for both configs', () => {
    const tpb = normalizeStream({
      name: 'Torrentio 1080p', title: 'Example.S01E01\n👤 20 💾 500 MB ⚙️ ThePirateBay',
      infoHash: 'a'.repeat(40), fileIdx: 0,
    }, 'synthetic');
    expect(tpb).toMatchObject({ sourceName: 'The Pirate Bay', sizeBytes: 500 * MEBIBYTE, seeders: 20 });
    for (const type of ['series', 'movie'] as const) {
      const competitor = candidate('rarbg', 1080, 500 * MEBIBYTE, 20, 'RARBG');
      expect(selectQuickWatch(type, [competitor, tpb]).winner?.stableId).toBe(tpb.stableId);
      expect(selectQuickWatch(type, [competitor, { ...tpb, sourceName: 'Other' }]).winner?.stableId).toBe('rarbg');
    }
  });
});
