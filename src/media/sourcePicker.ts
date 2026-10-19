import type { Resolution, StreamCandidate } from './types';
import { SERIES_QUICK_WATCH_V1 } from './quickWatch';

export type ResolutionFilter = 'all' | 'unknown' | `${NonNullable<Resolution>}`;

export function defaultResolutionFilter(episode: boolean): ResolutionFilter {
  return episode ? `${SERIES_QUICK_WATCH_V1.preferredResolution}` : 'all';
}

export function filterSources(candidates: readonly StreamCandidate[], resolution: ResolutionFilter): StreamCandidate[] {
  return candidates.filter((candidate) => resolution === 'all'
    || (resolution === 'unknown' ? candidate.resolution === null : candidate.resolution === Number(resolution)))
    .sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1) || a.stableId.localeCompare(b.stableId));
}
