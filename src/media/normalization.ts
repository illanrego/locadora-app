import { stableHash } from './hash';
import type {
  PlaybackDescriptor,
  RawAddonStream,
  Resolution,
  StreamCandidate,
  TransportType,
} from './types';

const MEBIBYTE = 1024 ** 2;
const GIBIBYTE = 1024 ** 3;

const SOURCE_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:the\s+pirate\s+bay|tpb)\b/i, 'The Pirate Bay'],
  [/\brarbg\b/i, 'RARBG'],
  [/\b(?:yts|yify|ytfs)\b/i, 'YTS/YIFY'],
  [/\b1337x\b/i, '1337x'],
];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNonNegativeInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function parseResolution(structured: unknown, display: string): Resolution {
  const source = `${text(structured)} ${display}`;
  const match = source.match(/(?:^|\D)(2160|1080|720|480)p?(?:\D|$)/i);
  return match ? Number(match[1]) as Exclude<Resolution, null> : null;
}

function parseSize(structured: unknown, display: string): number | null {
  const structuredNumber = typeof structured === 'number' ? structured : Number(structured);
  if (Number.isFinite(structuredNumber) && structuredNumber > 0) return Math.round(structuredNumber);

  const matches = [...display.matchAll(/(\d+(?:[.,]\d+)?)\s*(gib|gb|mib|mb)\b/gi)];
  if (!matches.length) return null;
  const [, value, unit] = matches.at(-1)!;
  const amount = Number(value.replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * (/^g/i.test(unit) ? GIBIBYTE : MEBIBYTE));
}

function parseSeeders(structured: unknown, display: string): number | null {
  const structuredNumber = finiteNonNegativeInteger(structured);
  if (structuredNumber !== null) return structuredNumber;
  const patterns = [
    /(?:seeders?|seeds?)\s*[:=]?\s*(\d+)/i,
    /(?:👤|🌱)\s*(\d+)/u,
    /\bS\s*[:=]\s*(\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = display.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export function normalizeSourceName(structured: unknown, display: string): string {
  const combined = `${text(structured)} ${display}`;
  for (const [pattern, canonical] of SOURCE_ALIASES) {
    if (pattern.test(combined)) return canonical;
  }
  return text(structured) || 'Other';
}

function normalizePlaybackDescriptor(raw: RawAddonStream): {
  descriptor: PlaybackDescriptor;
  transportType: TransportType;
  stableMaterial: string;
} {
  const infoHash = text(raw.infoHash).toLowerCase();
  const fileIndex = finiteNonNegativeInteger(raw.fileIdx);
  const announce = (Array.isArray(raw.announce) ? raw.announce : Array.isArray(raw.sources) ? raw.sources : [])
    .filter((source): source is string => typeof source === 'string')
    .map((source) => source.trim())
    .filter((source) => source.length > 0 && source.length <= 2_048)
    .slice(0, 32);
  if (/^[a-f0-9]{40}$/.test(infoHash)) {
    return {
      descriptor: { kind: 'torrent', infoHash, fileIndex, announce },
      transportType: 'torrent',
      stableMaterial: `torrent:${infoHash}:${fileIndex ?? ''}`,
    };
  }

  const urlValue = text(raw.url);
  if (urlValue) {
    try {
      const url = new URL(urlValue);
      if (['http:', 'https:'].includes(url.protocol)) {
        const safeIdentity = `${url.protocol}//${url.host}${url.pathname}`;
        return {
          descriptor: { kind: 'url', url: urlValue },
          transportType: 'http',
          stableMaterial: `url:${safeIdentity}`,
        };
      }
    } catch {
      // Invalid URLs become unsupported candidates for the manual explanation.
    }
  }

  const externalUrl = text(raw.externalUrl);
  if (externalUrl) {
    try {
      const url = new URL(externalUrl);
      if (['https:', 'http:'].includes(url.protocol)) {
        return {
          descriptor: { kind: 'external', externalUrl },
          transportType: 'external',
          stableMaterial: `external:${url.protocol}//${url.host}${url.pathname}`,
        };
      }
    } catch {
      // Invalid external URLs are unsupported.
    }
  }

  return {
    descriptor: { kind: 'unsupported' },
    transportType: 'unsupported',
    stableMaterial: `unsupported:${text(raw.name)}:${text(raw.title)}`,
  };
}

export function normalizeStream(raw: RawAddonStream, addonId: string, index = 0): StreamCandidate {
  const displayName = [text(raw.name), text(raw.title), text(raw.description), text(raw.behaviorHints?.filename)]
    .filter(Boolean)
    .join(' · ') || `Source ${index + 1}`;
  const resolution = parseResolution(raw.resolution, displayName);
  const sizeBytes = parseSize(raw.behaviorHints?.videoSize, displayName);
  const seeders = parseSeeders(raw.seeders, displayName);
  const sourceName = normalizeSourceName(raw.source, displayName);
  const playback = normalizePlaybackDescriptor(raw);
  const rejectionReasons: string[] = [];

  if (![720, 1080].includes(resolution ?? 0)) rejectionReasons.push('unsupported-or-unknown-resolution');
  if (sizeBytes === null) rejectionReasons.push('unknown-size');
  if (seeders === null) rejectionReasons.push('unknown-seeders');
  if (playback.transportType === 'unsupported') rejectionReasons.push('unsupported-transport');

  return {
    stableId: `${addonId}:${stableHash(`${playback.stableMaterial}:${displayName}:${index}`)}`,
    addonId,
    sourceName,
    resolution,
    sizeBytes,
    seeders,
    transportType: playback.transportType,
    displayName,
    playbackDescriptor: playback.descriptor,
    parseConfidence: rejectionReasons.length ? 'partial' : 'complete',
    rejectionReasons,
  };
}

export function normalizeStreams(rawStreams: unknown, addonId: string): StreamCandidate[] {
  if (!Array.isArray(rawStreams)) return [];
  return rawStreams
    .filter((stream): stream is RawAddonStream => Boolean(stream) && typeof stream === 'object')
    .map((stream, index) => normalizeStream(stream, addonId, index));
}

export const byteUnits = { MEBIBYTE, GIBIBYTE } as const;
