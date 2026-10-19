import type { ContentType } from '../domain/content';
import { byteUnits } from './normalization';
import type { StreamCandidate } from './types';

const { MEBIBYTE, GIBIBYTE } = byteUnits;

export interface QuickWatchConfig {
  version: 'movie-v1' | 'series-v1';
  preferredResolution: 1080;
  fallbackResolution: 720;
  minimumSeeders: 10 | 20;
  preferredMinimumBytes: number;
  preferredMaximumBytes: number;
  maximumBytes: number;
  sourceOrder: string[];
}

export const MOVIE_QUICK_WATCH_V1: QuickWatchConfig = Object.freeze({
  version: 'movie-v1',
  preferredResolution: 1080,
  fallbackResolution: 720,
  minimumSeeders: 10,
  preferredMinimumBytes: 500 * MEBIBYTE,
  preferredMaximumBytes: 2 * GIBIBYTE,
  maximumBytes: 5 * GIBIBYTE,
  sourceOrder: ['The Pirate Bay', 'RARBG', 'YTS/YIFY', '1337x'],
});

export const SERIES_QUICK_WATCH_V1: QuickWatchConfig = Object.freeze({
  ...MOVIE_QUICK_WATCH_V1,
  version: 'series-v1',
  minimumSeeders: 20,
  preferredMinimumBytes: 100 * MEBIBYTE,
  preferredMaximumBytes: 500 * MEBIBYTE,
  maximumBytes: GIBIBYTE,
  sourceOrder: [...MOVIE_QUICK_WATCH_V1.sourceOrder],
});

export type QuickWatchReason =
  | 'selected-preferred-1080p'
  | 'selected-larger-1080p'
  | 'selected-720p-fallback'
  | 'series-requires-manual-selection'
  | 'no-confident-candidates'
  | 'no-candidate-met-autoplay-rules';

export interface QuickWatchResult {
  rulesVersion: string;
  winner: StreamCandidate | null;
  tier: 1 | 2 | 3 | null;
  reason: QuickWatchReason;
  consideredCandidateIds: string[];
  manualCandidateIds: string[];
}

function sourceRank(candidate: StreamCandidate, config: QuickWatchConfig): number {
  if (config.version === 'series-v1'
    && (!candidate.sourceName.trim() || candidate.sourceName.trim().toLowerCase() === 'other')) {
    return config.sourceOrder.length + 1;
  }
  const index = config.sourceOrder.indexOf(candidate.sourceName);
  return index === -1 ? config.sourceOrder.length : index;
}

function compareWithinTier(a: StreamCandidate, b: StreamCandidate, config: QuickWatchConfig): number {
  // Episode rules put unnamed sources behind every named source in this bucket,
  // regardless of seeders. Preserve the established movie seeder-first ladder.
  if (config.version === 'series-v1') {
    const aUnnamed = sourceRank(a, config) > config.sourceOrder.length;
    const bUnnamed = sourceRank(b, config) > config.sourceOrder.length;
    if (aUnnamed !== bUnnamed) return Number(aUnnamed) - Number(bUnnamed);
  }
  return (b.seeders! - a.seeders!)
    || (sourceRank(a, config) - sourceRank(b, config))
    || (a.sizeBytes! - b.sizeBytes!)
    || a.stableId.localeCompare(b.stableId);
}

function confident(candidate: StreamCandidate): boolean {
  return candidate.parseConfidence === 'complete'
    && ['http', 'torrent'].includes(candidate.transportType)
    && candidate.sizeBytes !== null
    && candidate.seeders !== null;
}

function inRange(value: number, minimum: number, maximum: number): boolean {
  return value >= minimum && value <= maximum;
}

export function selectQuickWatch(
  contentType: ContentType,
  candidates: StreamCandidate[],
  config: QuickWatchConfig = MOVIE_QUICK_WATCH_V1,
): QuickWatchResult {
  // A caller passing the movie config must never relax the episode size ceiling.
  if (contentType === 'series') config = SERIES_QUICK_WATCH_V1;
  const manualCandidateIds = candidates
    .filter((candidate) => candidate.transportType !== 'unsupported')
    .map((candidate) => candidate.stableId);

  const normalized = candidates.filter(confident);
  if (!normalized.length) {
    return {
      rulesVersion: config.version,
      winner: null,
      tier: null,
      reason: contentType === 'series' ? 'series-requires-manual-selection' : 'no-confident-candidates',
      consideredCandidateIds: [],
      manualCandidateIds,
    };
  }

  const tiers: Array<{ tier: 1 | 2 | 3; reason: QuickWatchReason; candidates: StreamCandidate[] }> = [
    {
      tier: 1,
      reason: 'selected-preferred-1080p',
      candidates: normalized.filter((candidate) => candidate.resolution === 1080
        && inRange(candidate.sizeBytes!, config.preferredMinimumBytes, config.preferredMaximumBytes)
        && candidate.seeders! >= config.minimumSeeders),
    },
    {
      tier: 2,
      reason: 'selected-larger-1080p',
      candidates: normalized.filter((candidate) => candidate.resolution === 1080
        && candidate.sizeBytes! > config.preferredMaximumBytes
        && candidate.sizeBytes! <= config.maximumBytes
        && candidate.seeders! >= config.minimumSeeders),
    },
    {
      tier: 3,
      reason: 'selected-720p-fallback',
      candidates: normalized.filter((candidate) => candidate.resolution === 720
        && inRange(candidate.sizeBytes!, config.preferredMinimumBytes, config.maximumBytes)
        && candidate.seeders! >= config.minimumSeeders),
    },
  ];

  for (const entry of tiers) {
    if (!entry.candidates.length) continue;
    const sorted = [...entry.candidates].sort((a, b) => {
      if (entry.tier === 3) {
        const aBucket = a.sizeBytes! <= config.preferredMaximumBytes ? 0 : 1;
        const bBucket = b.sizeBytes! <= config.preferredMaximumBytes ? 0 : 1;
        if (aBucket !== bBucket) return aBucket - bBucket;
      }
      return compareWithinTier(a, b, config);
    });
    return {
      rulesVersion: config.version,
      winner: sorted[0],
      tier: entry.tier,
      reason: entry.reason,
      consideredCandidateIds: sorted.map((candidate) => candidate.stableId),
      manualCandidateIds,
    };
  }

  return {
    rulesVersion: config.version,
    winner: null,
    tier: null,
    reason: contentType === 'series' ? 'series-requires-manual-selection' : 'no-candidate-met-autoplay-rules',
    consideredCandidateIds: normalized.map((candidate) => candidate.stableId),
    manualCandidateIds,
  };
}
