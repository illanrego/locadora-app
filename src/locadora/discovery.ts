import { externalId, normalizeDiscoveryTitle, type ContentType, type DiscoveryTitle, type PublicTitlePayload } from '../domain/content';
import { fetchNativePublicShelf, fetchNativePublicTitle, isNativeShell } from '../platform/nativeBridge';
import { FIXTURE_TITLES } from './fixture';
import { cacheShelf, cacheTitle, readLocalShelf, readLocalTitle } from './localCache';

export interface ShelfQuery {
  genres: string[];
  year: number;
  type: ContentType;
  stand: number;
  locale: 'pt-BR' | 'en-US';
}

export interface ShelfPage {
  titles: DiscoveryTitle[];
  hasNextStand: boolean;
  source: 'fixture' | 'public-api';
}

function fixtureShelf(query: ShelfQuery): ShelfPage {
  const matchingType = FIXTURE_TITLES.filter((title) => title.identity.type === query.type);
  const matchingGenre = matchingType.filter((title) => !query.genres.length
    || title.genres.some((genre) => query.genres.includes(genre)));
  const matchingYear = matchingGenre.filter((title) => title.year === null || (title.year <= query.year && title.year >= query.year - 19));
  const preferred = matchingYear.length ? matchingYear : matchingGenre.length ? matchingGenre : matchingType;
  return { titles: preferred, hasNextStand: false, source: 'fixture' };
}

function endpoint(): string | null {
  const value = String(import.meta.env.VITE_LOCADORA_PUBLIC_API_URL ?? '').trim().replace(/\/$/, '');
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href.replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

function publicTitlePayload(body: unknown): PublicTitlePayload | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const meta = record.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) return meta as PublicTitlePayload;
  return record as PublicTitlePayload;
}

export async function loadShelf(query: ShelfQuery, signal?: AbortSignal): Promise<ShelfPage> {
  const cached = await readLocalShelf(query);
  if (cached) return cached;

  const base = endpoint();
  if (isNativeShell()) {
    const body = await fetchNativePublicShelf({
      genres: query.genres,
      year: query.year,
      contentType: query.type,
      stand: query.stand,
    }) as { titles?: PublicTitlePayload[]; hasNextStand?: boolean };
    if (!Array.isArray(body.titles)) throw new Error(query.locale === 'pt-BR' ? 'O acervo respondeu em um formato inválido.' : 'The catalogue returned an invalid response.');
    const page: ShelfPage = {
      titles: body.titles.map(normalizeDiscoveryTitle).filter((title): title is DiscoveryTitle => title !== null),
      hasNextStand: Boolean(body.hasNextStand),
      source: 'public-api',
    };
    void cacheShelf(query, page);
    return page;
  }
  if (!base) return fixtureShelf(query);
  const url = new URL(`${base}/shelf`);
  url.search = new URLSearchParams({
    genre: query.genres.join(','),
    year: String(query.year),
    type: query.type,
    stand: String(query.stand),
    providers: '',
    ignoreStoreYear: 'false',
  }).toString();
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(query.locale === 'pt-BR' ? 'O acervo público está indisponível.' : 'The public catalogue is unavailable.');
  const body = await response.json() as { titles?: PublicTitlePayload[]; hasNextStand?: boolean };
  if (!Array.isArray(body.titles)) throw new Error(query.locale === 'pt-BR' ? 'O acervo respondeu em um formato inválido.' : 'The catalogue returned an invalid response.');
  const page: ShelfPage = {
    titles: body.titles.map(normalizeDiscoveryTitle).filter((title): title is DiscoveryTitle => title !== null),
    hasNextStand: Boolean(body.hasNextStand),
    source: 'public-api',
  };
  void cacheShelf(query, page);
  return page;
}

/**
 * Shelf responses deliberately stay lightweight. Inspection fetches the public
 * metadata record separately so credits and availability never become member
 * or media-engine state.
 */
export async function loadTitleDetails(
  title: DiscoveryTitle,
  locale: ShelfQuery['locale'],
  signal?: AbortSignal,
): Promise<DiscoveryTitle> {
  const cached = await readLocalTitle(title, locale);
  if (cached) return cached;

  const tmdbId = Number(externalId(title.identity, 'tmdb'));
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return title;

  let body: unknown;
  if (isNativeShell()) {
    body = await fetchNativePublicTitle({ contentType: title.identity.type, tmdbId, locale });
  } else {
    const base = endpoint();
    if (!base) return title;
    const url = new URL(`${base}/title`);
    url.search = new URLSearchParams({ type: title.identity.type, id: `tmdb:${tmdbId}`, locale }).toString();
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
    if (!response.ok) return title;
    body = await response.json();
  }

  const payload = publicTitlePayload(body);
  if (!payload) return title;
  const normalized = normalizeDiscoveryTitle(payload);
  if (!normalized || normalized.identity.canonicalKey !== title.identity.canonicalKey) return title;
  void cacheTitle(normalized, locale);
  return normalized;
}
