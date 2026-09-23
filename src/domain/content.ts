export type ContentType = 'movie' | 'series';

export type ExternalNamespace = 'tmdb' | 'imdb' | 'stremio' | 'addon';

export interface ExternalIdentity {
  namespace: ExternalNamespace;
  externalId: string;
}

export interface ContentIdentity {
  /** Temporary bridge key. A persisted internal UUID will replace this later. */
  canonicalKey: `${ContentType}:tmdb:${number}`;
  type: ContentType;
  externalIdentities: ExternalIdentity[];
}

export interface DiscoveryTitle {
  identity: ContentIdentity;
  name: string;
  year: number | null;
  genres: string[];
  description: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  imdbRating: string | null;
  runtimeMinutes: number | null;
  certificationBR: string | null;
  director: string[];
  writer: string[];
  cast: string[];
  providers: string[];
}

export interface PublicTitlePayload {
  id?: string | number;
  tmdbId?: string | number;
  tmdb_id?: string | number;
  imdbId?: string;
  imdb_id?: string;
  type?: string;
  name?: string;
  title?: string;
  year?: string | number | null;
  genres?: unknown;
  description?: string;
  overview?: string;
  poster?: string;
  posterUrl?: string;
  background?: string;
  backdropUrl?: string;
  imdbRating?: string | number;
  runtime?: string | number;
  certificationBR?: string | number;
  director?: unknown;
  writer?: unknown;
  cast?: unknown;
  availabilityBR?: { providers?: unknown };
}

function positiveInteger(value: unknown): number | null {
  const normalized = typeof value === 'string' ? Number(value.replace(/^tmdb:/, '')) : Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function validYear(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 1888 && normalized <= 2200 ? normalized : null;
}

function optionalHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim().replace(/\s+/g, ' ');
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function boundedStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => typeof item === 'string' ? boundedString(item, 80) : null)
    .filter((item): item is string => item !== null))]
    .slice(0, maxItems);
}

function runtimeMinutes(value: unknown): number | null {
  const normalized = typeof value === 'string' ? Number(value.replace(/\s*min(?:utes?)?$/i, '')) : Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 && normalized <= 1_200 ? normalized : null;
}

export function normalizeDiscoveryTitle(payload: PublicTitlePayload): DiscoveryTitle | null {
  const type = payload.type === 'series' ? 'series' : payload.type === 'movie' ? 'movie' : null;
  const tmdbId = positiveInteger(payload.tmdbId ?? payload.tmdb_id ?? payload.id);
  const name = String(payload.name ?? payload.title ?? '').trim();
  if (!type || !tmdbId || !name) return null;

  const externalIdentities: ExternalIdentity[] = [{ namespace: 'tmdb', externalId: String(tmdbId) }];
  const imdbId = String(payload.imdbId ?? payload.imdb_id ?? '').trim();
  if (/^tt\d{5,12}$/.test(imdbId)) externalIdentities.push({ namespace: 'imdb', externalId: imdbId });

  const genres = boundedStringList(payload.genres, 6);

  return {
    identity: {
      canonicalKey: `${type}:tmdb:${tmdbId}`,
      type,
      externalIdentities,
    },
    name,
    year: validYear(payload.year),
    genres,
    description: String(payload.description ?? payload.overview ?? '').trim(),
    posterUrl: optionalHttpUrl(payload.posterUrl ?? payload.poster),
    backdropUrl: optionalHttpUrl(payload.backdropUrl ?? payload.background),
    imdbRating: boundedString(payload.imdbRating, 12),
    runtimeMinutes: runtimeMinutes(payload.runtime),
    certificationBR: boundedString(payload.certificationBR, 20),
    director: boundedStringList(payload.director, 4),
    writer: boundedStringList(payload.writer, 4),
    cast: boundedStringList(payload.cast, 10),
    providers: boundedStringList(payload.availabilityBR?.providers, 8),
  };
}

export function externalId(identity: ContentIdentity, namespace: ExternalNamespace): string | null {
  return identity.externalIdentities.find((item) => item.namespace === namespace)?.externalId ?? null;
}
