import { externalId, normalizeDiscoveryTitle, type ContentType, type DiscoveryTitle, type PublicTitlePayload } from '../domain/content';
import { fetchNativeCreditStand, fetchNativePublicPerson, fetchNativePublicPersonSearch, fetchNativePublicSearch, fetchNativePublicShelf, fetchNativePublicTitle, isNativeShell } from '../platform/nativeBridge';
import { normalizeTitleSearch } from './titleSearch';
import { normalizePersonSearch } from './personSearch';
import { FIXTURE_TITLES } from './fixture';
import { cacheShelf, cacheTitle, readLocalShelf, readLocalTitle } from './localCache';
import { DEPARTMENTS, normalizePerson, validPersonId, type CreditStandSelection, type PersonProfile } from './creditStands';

export type ShelfSort = 'relevance' | 'year' | 'rating';

export interface ShelfQuery {
  genres: string[];
  year: number;
  type: ContentType;
  stand: number;
  locale: 'pt-BR' | 'en-US';
  sort?: ShelfSort;
}

export interface ShelfPage {
  titles: DiscoveryTitle[];
  hasNextStand: boolean;
  source: 'fixture' | 'public-api';
}

export interface CreditStandQuery {
  credit: CreditStandSelection;
  year: number;
  stand: number;
  sort: ShelfSort;
  locale: ShelfQuery['locale'];
}

const DEFAULT_PUBLIC_API = 'https://locadora-api.willstartpage.workers.dev/v1';

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

function creditEndpoint(): string {
  return endpoint() ?? DEFAULT_PUBLIC_API;
}

export async function searchTitles(query: string, locale: ShelfQuery['locale'], signal?: AbortSignal): Promise<DiscoveryTitle[]> {
  const trimmed = query.trim();
  const length = Array.from(trimmed).length;
  if (length < 2 || length > 80) throw new Error(locale === 'pt-BR' ? 'Digite de 2 a 80 caracteres.' : 'Enter 2 to 80 characters.');
  let body: unknown;
  if (isNativeShell()) {
    body = await fetchNativePublicSearch({ query: trimmed, locale });
  } else {
    const url = new URL(`${creditEndpoint()}/search`);
    url.search = new URLSearchParams({ q: trimmed, locale }).toString();
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
    if (!response.ok) throw new Error(locale === 'pt-BR' ? 'Não foi possível buscar títulos.' : 'Could not search titles.');
    body = await response.json();
  }
  const titles = normalizeTitleSearch(body);
  if (!titles) throw new Error(locale === 'pt-BR' ? 'A busca respondeu em um formato inválido.' : 'Search returned an invalid response.');
  return titles;
}

export async function searchPeople(query: string, locale: ShelfQuery['locale'], signal?: AbortSignal): Promise<CreditStandSelection[]> {
  const trimmed = query.trim();
  const length = Array.from(trimmed).length;
  if (length < 2 || length > 80) throw new Error(locale === 'pt-BR' ? 'Digite de 2 a 80 caracteres.' : 'Enter 2 to 80 characters.');
  let body: unknown;
  if (isNativeShell()) {
    try { body = await fetchNativePublicPersonSearch({ query: trimmed, locale }); }
    catch { throw new Error(locale === 'pt-BR' ? 'Não foi possível buscar pessoas.' : 'Could not search people.'); }
  } else {
    const url = new URL(`${creditEndpoint()}/person-search`);
    url.search = new URLSearchParams({ q: trimmed, locale }).toString();
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
    if (!response.ok) throw new Error(locale === 'pt-BR' ? 'Não foi possível buscar pessoas.' : 'Could not search people.');
    body = await response.json();
  }
  const people = normalizePersonSearch(body);
  if (!people) throw new Error(locale === 'pt-BR' ? 'A busca respondeu em um formato inválido.' : 'Search returned an invalid response.');
  return people;
}

export async function loadPerson(personId: string, locale: ShelfQuery['locale'], signal?: AbortSignal): Promise<PersonProfile> {
  if (!validPersonId(personId)) throw new Error(locale === 'pt-BR' ? 'Pessoa inválida.' : 'Invalid person.');
  let body: unknown;
  if (isNativeShell()) {
    try { body = await fetchNativePublicPerson({ personId, locale }); }
    catch { throw new Error(locale === 'pt-BR' ? 'Não foi possível abrir esta pessoa.' : 'Could not open this person.'); }
  }
  else {
    const url = new URL(`${creditEndpoint()}/person`);
    url.search = new URLSearchParams({ id: personId, locale }).toString();
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
    if (!response.ok) throw new Error(locale === 'pt-BR' ? 'Não foi possível abrir esta pessoa.' : 'Could not open this person.');
    body = await response.json();
  }
  const profile = normalizePerson(body);
  if (!profile || profile.id !== personId) throw new Error(locale === 'pt-BR' ? 'Dados da pessoa inválidos.' : 'Invalid person data.');
  return profile;
}

export async function loadCreditStand(query: CreditStandQuery, signal?: AbortSignal): Promise<ShelfPage> {
  const { credit, year, stand, sort, locale } = query;
  if (!validPersonId(credit.id) || !DEPARTMENTS.includes(credit.department as typeof DEPARTMENTS[number])
    || !Number.isInteger(year) || year < 1920 || year > 2200 || !Number.isInteger(stand) || stand < 0 || stand > 20) {
    throw new Error(locale === 'pt-BR' ? 'Estante de créditos inválida.' : 'Invalid credit stand.');
  }
  let body: unknown;
  if (isNativeShell()) {
    try { body = await fetchNativeCreditStand({ personId: credit.id, department: credit.department, year, stand, sort, locale }); }
    catch { throw new Error(locale === 'pt-BR' ? 'Não foi possível abrir a estante da pessoa.' : 'Could not open the person stand.'); }
  }
  else {
    const url = new URL(`${creditEndpoint()}/credit-stand`);
    url.search = new URLSearchParams({
      person: credit.id, department: credit.department, job: '', type: 'all', year: String(year),
      ignoreStoreYear: 'true', providers: '', stand: String(stand), sort, locale,
    }).toString();
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
    if (!response.ok) throw new Error(locale === 'pt-BR' ? 'Não foi possível abrir a estante da pessoa.' : 'Could not open the person stand.');
    body = await response.json();
  }
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (!Array.isArray(record.titles)) throw new Error(locale === 'pt-BR' ? 'A estante respondeu em um formato inválido.' : 'The stand returned an invalid response.');
  return {
    titles: record.titles.slice(0, 40).map((value) => normalizeDiscoveryTitle(value as PublicTitlePayload)).filter((title): title is DiscoveryTitle => title !== null),
    hasNextStand: record.hasNextStand === true,
    source: 'public-api',
  };
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
      sort: query.sort ?? 'relevance',
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
    sort: query.sort ?? 'relevance',
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
