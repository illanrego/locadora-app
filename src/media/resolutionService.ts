import { externalId, type DiscoveryTitle } from '../domain/content';
import {
  fetchConfiguredAddonResource,
  type ConfiguredAddon,
} from '../platform/nativeBridge';
import { normalizeStreams } from './normalization';
import { selectQuickWatch, type QuickWatchResult } from './quickWatch';
import { safeDiagnostic } from './redaction';
import type { StreamCandidate } from './types';

export type ResolutionStatus =
  | 'resolved'
  | 'manual-selection-required'
  | 'identity-unmapped'
  | 'no-configured-stream-addons'
  | 'no-sources'
  | 'cancelled';

export interface AddonResolutionDiagnostic {
  addonId: string;
  outcome: 'fulfilled' | 'failed';
  candidateCount: number;
  message: string | null;
}

export interface MediaResolution {
  status: ResolutionStatus;
  imdbId: string | null;
  candidates: StreamCandidate[];
  quickWatch: QuickWatchResult | null;
  manualCandidates: StreamCandidate[];
  diagnostics: AddonResolutionDiagnostic[];
}

export type ConfiguredResourceFetcher = typeof fetchConfiguredAddonResource;

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

function manualOrder(a: StreamCandidate, b: StreamCandidate): number {
  return (b.resolution ?? 0) - (a.resolution ?? 0)
    || (b.seeders ?? -1) - (a.seeders ?? -1)
    || (a.sizeBytes ?? Number.MAX_SAFE_INTEGER) - (b.sizeBytes ?? Number.MAX_SAFE_INTEGER)
    || a.stableId.localeCompare(b.stableId);
}

function emptyResolution(status: ResolutionStatus, imdbId: string | null): MediaResolution {
  return { status, imdbId, candidates: [], quickWatch: null, manualCandidates: [], diagnostics: [] };
}

export async function resolveTitleMedia(
  title: DiscoveryTitle,
  addons: ConfiguredAddon[],
  options: { signal?: AbortSignal; fetcher?: ConfiguredResourceFetcher } = {},
): Promise<MediaResolution> {
  const imdbId = externalId(title.identity, 'imdb');
  if (!imdbId) return emptyResolution('identity-unmapped', null);
  const streamAddons = addons.filter((addon) => addon.supportsStreams);
  if (!streamAddons.length) return emptyResolution('no-configured-stream-addons', imdbId);
  if (aborted(options.signal)) return emptyResolution('cancelled', imdbId);

  const fetcher = options.fetcher ?? fetchConfiguredAddonResource;
  const settled = await Promise.allSettled(streamAddons.map(async (addon) => {
    const body = await fetcher({
      addonId: addon.id,
      resource: 'stream',
      contentType: title.identity.type,
      id: imdbId,
    });
    if (!body || typeof body !== 'object' || !Array.isArray((body as { streams?: unknown }).streams)) {
      throw new Error('Add-on returned an invalid stream response');
    }
    return { addon, candidates: normalizeStreams((body as { streams: unknown[] }).streams, addon.id) };
  }));
  if (aborted(options.signal)) return emptyResolution('cancelled', imdbId);

  const diagnostics: AddonResolutionDiagnostic[] = [];
  const candidates: StreamCandidate[] = [];
  settled.forEach((result, index) => {
    const addon = streamAddons[index];
    if (result.status === 'fulfilled') {
      candidates.push(...result.value.candidates);
      diagnostics.push({ addonId: addon.id, outcome: 'fulfilled', candidateCount: result.value.candidates.length, message: null });
    } else {
      diagnostics.push({ addonId: addon.id, outcome: 'failed', candidateCount: 0, message: safeDiagnostic(result.reason) });
    }
  });
  if (!candidates.length) {
    return { ...emptyResolution('no-sources', imdbId), diagnostics };
  }

  const quickWatch = selectQuickWatch(title.identity.type, candidates);
  const manualCandidates = candidates
    .filter((candidate) => candidate.transportType !== 'unsupported')
    .sort(manualOrder);
  return {
    status: quickWatch.winner ? 'resolved' : 'manual-selection-required',
    imdbId,
    candidates,
    quickWatch,
    manualCandidates,
    diagnostics,
  };
}
