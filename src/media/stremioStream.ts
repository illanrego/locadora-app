import type { StreamCandidate } from './types';

export type StremioPlayableStream =
  | { url: string }
  | { infoHash: string; fileIdx: number | null; announce: string[] };

export function toStremioPlayableStream(candidate: StreamCandidate): StremioPlayableStream | null {
  switch (candidate.playbackDescriptor.kind) {
    case 'url':
      return { url: candidate.playbackDescriptor.url };
    case 'torrent':
      return {
        infoHash: candidate.playbackDescriptor.infoHash,
        fileIdx: candidate.playbackDescriptor.fileIndex,
        announce: candidate.playbackDescriptor.announce,
      };
    default:
      return null;
  }
}
