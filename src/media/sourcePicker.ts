import type { Resolution, StreamCandidate } from './types';

export type ResolutionFilter = 'all' | 'unknown' | `${NonNullable<Resolution>}`;

export function filterSources(candidates: readonly StreamCandidate[], resolution: ResolutionFilter): StreamCandidate[] {
  return candidates.filter((candidate) => resolution === 'all'
    || (resolution === 'unknown' ? candidate.resolution === null : candidate.resolution === Number(resolution)))
    .sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1) || a.stableId.localeCompare(b.stableId));
}
