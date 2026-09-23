import type { DiscoveryTitle } from '../domain/content';
import type { ShelfPage, ShelfQuery } from './discovery';

const STORAGE_KEY = 'wills-locadora.catalog-cache.v1';
const MAX_SHELF_PAGES = 96;
const MAX_TITLES = 4_000;

interface StoredShelf {
  page: ShelfPage;
  savedAt: number;
}

interface StoredTitle {
  title: DiscoveryTitle;
  complete: boolean;
  savedAt: number;
}

interface LocalCatalogueState {
  version: 1;
  shelves: Record<string, StoredShelf>;
  titles: Record<string, StoredTitle>;
}

function emptyState(): LocalCatalogueState {
  return { version: 1, shelves: {}, titles: {} };
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readState(): LocalCatalogueState {
  const value = storage();
  if (!value) return emptyState();
  try {
    const parsed = JSON.parse(value.getItem(STORAGE_KEY) ?? 'null') as Partial<LocalCatalogueState> | null;
    if (!parsed || parsed.version !== 1 || !parsed.shelves || !parsed.titles) return emptyState();
    return parsed as LocalCatalogueState;
  } catch {
    return emptyState();
  }
}

function writeState(state: LocalCatalogueState): void {
  const value = storage();
  if (!value) return;
  try {
    value.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browsers can reject localStorage when the profile quota is full. The
    // catalogue remains usable for this session in that case.
  }
}

function shelfKey(query: ShelfQuery): string {
  return JSON.stringify({
    genres: [...query.genres].sort(),
    year: query.year,
    type: query.type,
    stand: query.stand,
    locale: query.locale,
  });
}

function trimState(state: LocalCatalogueState): void {
  const shelves = Object.entries(state.shelves)
    .sort(([, left], [, right]) => right.savedAt - left.savedAt)
    .slice(0, MAX_SHELF_PAGES);
  state.shelves = Object.fromEntries(shelves);

  const titles = Object.entries(state.titles)
    .sort(([, left], [, right]) => right.savedAt - left.savedAt)
    .slice(0, MAX_TITLES);
  state.titles = Object.fromEntries(titles);
}

export function readLocalShelf(query: ShelfQuery): ShelfPage | null {
  return readState().shelves[shelfKey(query)]?.page ?? null;
}

export function cacheShelf(query: ShelfQuery, page: ShelfPage): void {
  const state = readState();
  const savedAt = Date.now();
  state.shelves[shelfKey(query)] = { page, savedAt };
  for (const title of page.titles) {
    const key = title.identity.canonicalKey;
    const current = state.titles[key];
    state.titles[key] = current?.complete
      ? { ...current, savedAt }
      : { title, complete: false, savedAt };
  }
  trimState(state);
  writeState(state);
}

export function readLocalTitle(title: DiscoveryTitle): DiscoveryTitle | null {
  const cached = readState().titles[title.identity.canonicalKey];
  return cached?.complete ? cached.title : null;
}

export function cacheTitle(title: DiscoveryTitle): void {
  const state = readState();
  state.titles[title.identity.canonicalKey] = { title, complete: true, savedAt: Date.now() };
  trimState(state);
  writeState(state);
}
