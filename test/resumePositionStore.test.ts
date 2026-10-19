// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllResumePositions,
  clearEpisodeResumePositions,
  clearSeriesResumePositions,
  readResumePosition,
  writeResumePosition,
} from '../src/media/resumePositionStore';

const DAY = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 9, 19, 12);
const identity = (index: number) => `url:${index.toString(16).padStart(8, '0')}`;

beforeEach(() => window.localStorage.clear());

describe('video-identity resume positions', () => {
  it('returns a valid position only for the same video identity', () => {
    writeResumePosition(identity(1), 750, 3_600, undefined, NOW);

    expect(readResumePosition(identity(1), NOW)).toMatchObject({
      positionSeconds: 750,
      durationSeconds: 3_600,
      writtenAt: NOW,
    });
    expect(readResumePosition(identity(2), NOW)).toBeNull();
  });

  it('does not resume finished positions and expires old positions', () => {
    writeResumePosition(identity(1), 949, 1_000, undefined, NOW);
    expect(readResumePosition(identity(1), NOW)).toMatchObject({ positionSeconds: 949 });

    writeResumePosition(identity(1), 950, 1_000, undefined, NOW);
    expect(readResumePosition(identity(1), NOW)).toBeNull();
    writeResumePosition(identity(2), 69, 100, undefined, NOW);
    expect(readResumePosition(identity(2), NOW)).toMatchObject({ positionSeconds: 69 });
    writeResumePosition(identity(2), 70, 100, undefined, NOW);
    expect(readResumePosition(identity(2), NOW)).toBeNull();

    writeResumePosition(identity(3), 20, 100, undefined, NOW - 91 * DAY);
    expect(readResumePosition(identity(3), NOW)).toBeNull();
  });

  it('ignores malformed, non-finite, negative and at-duration values', () => {
    const prefix = 'locadora:resume:v1:';
    const malformed = [
      '{',
      JSON.stringify({ positionSeconds: -1, durationSeconds: 100, writtenAt: NOW }),
      JSON.stringify({ positionSeconds: null, durationSeconds: 100, writtenAt: NOW }),
      JSON.stringify({ positionSeconds: 100, durationSeconds: 100, writtenAt: NOW }),
      JSON.stringify({ positionSeconds: 10, durationSeconds: 100, writtenAt: 'today' }),
      JSON.stringify({ positionSeconds: 10, durationSeconds: 100, writtenAt: NOW, seriesId: 'tt0182576' }),
    ];
    malformed.forEach((value, index) => {
      window.localStorage.setItem(`${prefix}${identity(index + 1)}`, value);
      expect(readResumePosition(identity(index + 1), NOW)).toBeNull();
    });
    writeResumePosition(identity(20), Number.NaN, 100, undefined, NOW);
    writeResumePosition(identity(21), 20, 100, undefined, NOW);
    writeResumePosition(identity(21), 100, 100, undefined, NOW);
    expect(readResumePosition(identity(20), NOW)).toBeNull();
    expect(readResumePosition(identity(21), NOW)).toBeNull();
  });

  it('caps records at 300 and prunes the oldest write', () => {
    for (let index = 1; index <= 301; index += 1) {
      writeResumePosition(identity(index), 10, 100, undefined, NOW + index);
    }

    const resumeKeys = Object.keys(window.localStorage)
      .filter((key) => key.startsWith('locadora:resume:v1:'));
    expect(resumeKeys).toHaveLength(300);
    expect(readResumePosition(identity(1), NOW + 301)).toBeNull();
    expect(readResumePosition(identity(301), NOW + 301)).toMatchObject({ writtenAt: NOW + 301 });
  });

  it('clears one episode, one series, or every resume position by stored context', () => {
    const first = { seriesId: 'tt0182576', season: 1, episode: 1 };
    const second = { seriesId: 'tt0182576', season: 1, episode: 2 };
    writeResumePosition(identity(1), 10, 100, first, NOW);
    writeResumePosition(identity(2), 10, 100, second, NOW);
    writeResumePosition(identity(3), 10, 100, { seriesId: 'tt0903747', season: 1, episode: 1 }, NOW);
    writeResumePosition(identity(4), 10, 100, undefined, NOW);

    clearEpisodeResumePositions(first.seriesId, first.season, first.episode);
    expect(readResumePosition(identity(1), NOW)).toBeNull();
    expect(readResumePosition(identity(2), NOW)).not.toBeNull();
    clearSeriesResumePositions(first.seriesId);
    expect(readResumePosition(identity(2), NOW)).toBeNull();
    expect(readResumePosition(identity(3), NOW)).not.toBeNull();
    expect(readResumePosition(identity(4), NOW)).not.toBeNull();
    clearAllResumePositions();
    expect(readResumePosition(identity(3), NOW)).toBeNull();
    expect(readResumePosition(identity(4), NOW)).toBeNull();
  });
});
