import { stableHash } from './hash';

export type PreferredSubtitleLanguage = 'pt-BR' | 'pt-PT' | 'pt' | 'en' | 'other';

export interface RawSubtitleTrack {
  id?: unknown;
  url?: unknown;
  lang?: unknown;
  label?: unknown;
}

export interface SubtitleTrack {
  id: string;
  url: string;
  language: PreferredSubtitleLanguage;
  label: string;
  isPreferred: boolean;
}

const PORTUGUESE_BRAZIL = new Set(['pt-br', 'pob', 'pb', 'por-br', 'brazilian portuguese']);
const PORTUGUESE_PORTUGAL = new Set(['pt-pt', 'por-pt', 'european portuguese']);
const PORTUGUESE = new Set(['pt', 'por', 'portuguese']);
const ENGLISH = new Set(['en', 'eng', 'english']);

export function normalizeSubtitleLanguage(value: unknown): PreferredSubtitleLanguage {
  const lang = String(value ?? '').trim().toLowerCase().replace('_', '-');
  if (PORTUGUESE_BRAZIL.has(lang)) return 'pt-BR';
  if (PORTUGUESE_PORTUGAL.has(lang)) return 'pt-PT';
  if (PORTUGUESE.has(lang)) return 'pt';
  if (ENGLISH.has(lang)) return 'en';
  return 'other';
}

function languageRank(language: PreferredSubtitleLanguage): number {
  return ({ 'pt-BR': 0, pt: 1, 'pt-PT': 2, en: 3, other: 4 })[language];
}

export function normalizeSubtitleTracks(rawTracks: unknown): SubtitleTrack[] {
  if (!Array.isArray(rawTracks)) return [];
  return rawTracks.slice(0, 128).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const track = raw as RawSubtitleTrack;
    const url = typeof track.url === 'string' ? track.url.trim() : '';
    if (!url || url.length > 8_192) return [];
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return [];
    } catch {
      return [];
    }
    const language = normalizeSubtitleLanguage(track.lang);
    const rawId = String(track.id ?? '').trim().slice(0, 256);
    const label = String(track.label ?? track.lang ?? `Subtitle ${index + 1}`).trim().slice(0, 256);
    return [{
      id: rawId || `subtitle-${stableHash(`${url}:${index}`)}`,
      url,
      language,
      label,
      isPreferred: language !== 'other',
    }];
  }).sort((a, b) => languageRank(a.language) - languageRank(b.language) || a.label.localeCompare(b.label));
}

export function groupSubtitleTracks(tracks: SubtitleTrack[]): { preferred: SubtitleTrack[]; other: SubtitleTrack[] } {
  return {
    preferred: tracks.filter((track) => track.isPreferred),
    other: tracks.filter((track) => !track.isPreferred),
  };
}

export function subtitleDelayFingerprint(videoFingerprint: string, track: Pick<SubtitleTrack, 'id'>): string {
  return `subtitle-delay:${stableHash(`${videoFingerprint}:${track.id}`)}`;
}
