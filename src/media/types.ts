import type { ContentType } from '../domain/content';

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

export interface AddonManifestResource {
  name: string;
  types?: string[];
  idPrefixes?: string[];
}

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  types: string[];
  resources: Array<string | AddonManifestResource>;
}

export interface AddonConnection {
  manifest: AddonManifest;
  /** Kept opaque and must never be rendered or logged. */
  manifestUrl: string;
}

export interface StreamRequest {
  type: ContentType;
  videoId: string;
}
