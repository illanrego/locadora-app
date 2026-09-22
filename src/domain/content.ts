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

export function normalizeDiscoveryTitle(payload: PublicTitlePayload): DiscoveryTitle | null {
  const type = payload.type === 'series' ? 'series' : payload.type === 'movie' ? 'movie' : null;
  const tmdbId = positiveInteger(payload.tmdbId ?? payload.tmdb_id ?? payload.id);
  const name = String(payload.name ?? payload.title ?? '').trim();
  if (!type || !tmdbId || !name) return null;

  const externalIdentities: ExternalIdentity[] = [{ namespace: 'tmdb', externalId: String(tmdbId) }];
  const imdbId = String(payload.imdbId ?? payload.imdb_id ?? '').trim();
  if (/^tt\d{5,12}$/.test(imdbId)) externalIdentities.push({ namespace: 'imdb', externalId: imdbId });

  const genres = Array.isArray(payload.genres)
    ? payload.genres.filter((genre): genre is string => typeof genre === 'string' && Boolean(genre.trim())).map((genre) => genre.trim())
    : [];

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
  };
}

export function externalId(identity: ContentIdentity, namespace: ExternalNamespace): string | null {
  return identity.externalIdentities.find((item) => item.namespace === namespace)?.externalId ?? null;
}
