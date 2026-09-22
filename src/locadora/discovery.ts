import { normalizeDiscoveryTitle, type ContentType, type DiscoveryTitle, type PublicTitlePayload } from '../domain/content';
import { FIXTURE_TITLES } from './fixture';

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

export async function loadShelf(query: ShelfQuery, signal?: AbortSignal): Promise<ShelfPage> {
  const base = endpoint();
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
  return {
    titles: body.titles.map(normalizeDiscoveryTitle).filter((title): title is DiscoveryTitle => title !== null),
    hasNextStand: Boolean(body.hasNextStand),
    source: 'public-api',
  };
}
