export type Resolution = 720 | 1080 | 2160 | 480 | null;
export type ParseConfidence = 'complete' | 'partial';
export type TransportType = 'http' | 'torrent' | 'external' | 'unsupported';

export type PlaybackDescriptor =
  | { kind: 'url'; url: string }
  | { kind: 'torrent'; infoHash: string; fileIndex: number | null }
  | { kind: 'external'; externalUrl: string }
  | { kind: 'unsupported' };

export interface StreamCandidate {
  stableId: string;
  addonId: string;
  sourceName: string;
  resolution: Resolution;
  sizeBytes: number | null;
  seeders: number | null;
  transportType: TransportType;
  displayName: string;
  playbackDescriptor: PlaybackDescriptor;
  parseConfidence: ParseConfidence;
  rejectionReasons: string[];
}

export interface RawAddonStream {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  url?: unknown;
  externalUrl?: unknown;
  infoHash?: unknown;
  fileIdx?: unknown;
  resolution?: unknown;
  seeders?: unknown;
  source?: unknown;
  behaviorHints?: {
    videoSize?: unknown;
    filename?: unknown;
    bingeGroup?: unknown;
  } | null;
}
