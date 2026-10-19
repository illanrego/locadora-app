import { describe, expect, it } from 'vitest';
import { defaultResolutionFilter, filterSources } from '../src/media/sourcePicker';
import { normalizeStreams } from '../src/media/normalization';

describe('manual source resolution filter', () => {
  it('defaults films to every resolution and episodes to the series preference', () => {
    expect(defaultResolutionFilter(false)).toBe('all');
    expect(defaultResolutionFilter(true)).toBe('1080');
  });

  it('filters independently of Quick Watch tiers and sorts seeds descending with unknown last', () => {
    const candidates = normalizeStreams([
      { name: 'Low', resolution: 1080, seeders: 2 },
      { name: 'Unknown seeds', resolution: 1080 },
      { name: 'High', resolution: 1080, seeders: 100 },
      { name: 'Zero', resolution: 1080, seeders: 0 },
      { name: 'SD', resolution: 480, seeders: 500 },
      { name: 'Unknown resolution', seeders: 10 },
    ], 'synthetic');
    const original = [...candidates];
    expect(filterSources(candidates, '1080').map((c) => c.seeders)).toEqual([100, 2, 0, null]);
    expect(filterSources(candidates, 'all')[0].resolution).toBe(480);
    expect(filterSources(candidates, 'unknown')).toHaveLength(1);
    expect(filterSources(candidates, '2160')).toEqual([]);
    expect(candidates).toEqual(original);
  });
});
