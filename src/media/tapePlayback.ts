import { externalId, type DiscoveryTitle } from '../domain/content';
import { ensureTapeEngine, readTapeManifest, TAPE_ENGINE_ORIGIN } from '../platform/tape';
import { normalizeManifest } from '../rentals/tapeManifest';
import { episodeVideoId, type BoundedEpisode } from './seriesEpisodes';
import type { StreamCandidate } from './types';

/** A read-only snapshot: playback never repairs or advances a tape job. */
export async function resolveReadyTape(
  title: DiscoveryTitle,
  episode?: Pick<BoundedEpisode, 'season' | 'episode'> | null,
  signal?: AbortSignal,
): Promise<StreamCandidate | null> {
  try {
    if (signal?.aborted) return null;
    // v1 has no episode fields. Its contentId must identify the actual video;
    // a series-level rental key cannot prove which episode the file contains.
    const imdbId = externalId(title.identity, 'imdb');
    const contentId = title.identity.type === 'series'
      ? (episode && imdbId ? episodeVideoId(imdbId, episode) : null)
      : title.identity.canonicalKey;
    if (!contentId) return null;
    const manifest = normalizeManifest(await readTapeManifest());
    if (signal?.aborted) return null;
    const tape = manifest.tapes.find((row) => row.contentId === contentId
      && (row.state === 'ready' || row.state === 'seeding'));
    if (!tape) return null;
    await ensureTapeEngine();
    if (signal?.aborted) return null;
    return {
      stableId: `tape:${tape.infoHash}:${tape.fileIdx}`,
      addonId: 'local-tape',
      sourceName: tape.title,
      displayName: tape.title,
      resolution: null,
      sizeBytes: tape.sizeBytes,
      seeders: null,
      transportType: 'http',
      playbackDescriptor: { kind: 'url', url: `${TAPE_ENGINE_ORIGIN}/${tape.infoHash}/${tape.fileIdx}` },
      parseConfidence: 'complete',
      rejectionReasons: [],
    };
  } catch {
    // The optional local copy must never cost the user their normal stream.
    return null;
  }
}
