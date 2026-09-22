import { externalId, normalizeDiscoveryTitle, type DiscoveryTitle } from '../domain/content';

export type SavedCollection = 'watch_later' | 'favorite';

export interface LocalSavedCollections {
  watch_later: DiscoveryTitle[];
  favorite: DiscoveryTitle[];
}

const STORAGE_KEY = 'wills-locadora.saved.v1';
const EMPTY: LocalSavedCollections = { watch_later: [], favorite: [] };

function storedTitle(title: DiscoveryTitle) {
  return {
    tmdbId: externalId(title.identity, 'tmdb'),
    imdbId: externalId(title.identity, 'imdb') ?? undefined,
    type: title.identity.type,
    name: title.name,
    year: title.year,
    genres: title.genres,
    description: title.description,
    posterUrl: title.posterUrl,
    backdropUrl: title.backdropUrl,
  };
}

function normalizeList(value: unknown): DiscoveryTitle[] {
  if (!Array.isArray(value)) return [];
  const titles = value.slice(0, 500).map((item) => normalizeDiscoveryTitle(item as Record<string, unknown>)).filter((item): item is DiscoveryTitle => item !== null);
  return [...new Map(titles.map((title) => [title.identity.canonicalKey, title])).values()];
}

export function readLocalSavedCollections(): LocalSavedCollections {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return {
      watch_later: normalizeList(value.watch_later),
      favorite: normalizeList(value.favorite),
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeLocalSavedCollections(collections: LocalSavedCollections): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    watch_later: collections.watch_later.map(storedTitle),
    favorite: collections.favorite.map(storedTitle),
  }));
}

export function setLocalSavedTitle(
  collections: LocalSavedCollections,
  title: DiscoveryTitle,
  collection: SavedCollection,
  enabled: boolean,
): LocalSavedCollections {
  const current = collections[collection].filter((item) => item.identity.canonicalKey !== title.identity.canonicalKey);
  return {
    ...collections,
    [collection]: enabled ? [title, ...current].slice(0, 500) : current,
  };
}

export function hasLocalSavedTitle(collections: LocalSavedCollections, title: DiscoveryTitle, collection: SavedCollection): boolean {
  return collections[collection].some((item) => item.identity.canonicalKey === title.identity.canonicalKey);
}
