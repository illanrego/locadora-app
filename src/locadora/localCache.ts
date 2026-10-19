import type { DiscoveryTitle } from '../domain/content';
import {
  boundedOverview,
  isSeriesImdbId,
  type BoundedEpisode,
  type SeriesEpisodes,
} from '../media/seriesEpisodes';
import type { ShelfPage, ShelfQuery } from './discovery';

type Store = 'shelves' | 'titles' | 'seriesEpisodes';
const LIMITS: Record<Store, number> = { shelves: 96, titles: 4_000, seriesEpisodes: 64 };
const DATABASE_VERSION = 3;
const MAX_WATCHED_EPISODES = 500;
// Bump when the cached shape changes. Records written by an earlier build then simply stop matching
// their key, so a tape cached before a feature (for example the credits block with person ids, or the
// bounded episode overview/air-date context) is re-fetched instead of being rendered without it.
// Dropped records are pruned by the store limit.
const CACHE_VERSION = 3;
const session: Record<Store, Map<string, unknown>> = {
  shelves: new Map(),
  titles: new Map(),
  seriesEpisodes: new Map(),
};
let database: Promise<IDBDatabase | null> | undefined;

export interface ProgressRecord {
  seriesId: string;
  season: number;
  episode: number;
  watched: Record<string, string>;
  updatedAt: string;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function remember(store: Store, key: string, value: unknown): void {
  const entries = session[store];
  entries.delete(key);
  entries.set(key, value);
  while (entries.size > LIMITS[store]) entries.delete(entries.keys().next().value!);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (database) return database;
  database = (async () => {
    try {
      if (typeof indexedDB === 'undefined') return null;
      const opening = indexedDB.open('wills-locadora-catalogue', DATABASE_VERSION);
      opening.onupgradeneeded = () => {
        for (const name of ['shelves', 'titles', 'seriesEpisodes']) {
          if (!opening.result.objectStoreNames.contains(name)) {
            opening.result.createObjectStore(name, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
          }
        }
        if (!opening.result.objectStoreNames.contains('progress')) {
          opening.result.createObjectStore('progress', { keyPath: 'key' });
        }
      };
      const db = await request(opening);
      db.onversionchange = () => { db.close(); database = undefined; };
      // Old details have no language. Only shelves can be migrated safely.
      try {
        const old = JSON.parse(localStorage.getItem('wills-locadora.catalog-cache.v1') ?? 'null');
        if (old?.version === 1 && old.shelves) {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('shelves', 'readwrite');
            const store = tx.objectStore('shelves');
            Object.entries(old.shelves).slice(0, LIMITS.shelves).forEach(([key, entry]) => {
              const record = entry as { page?: ShelfPage; savedAt?: number };
              if (Array.isArray(record?.page?.titles)) store.put({ key, value: record.page, savedAt: record.savedAt ?? 0 });
            });
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
            tx.onerror = () => reject(tx.error);
          });
          localStorage.removeItem('wills-locadora.catalog-cache.v1');
        }
      } catch { /* Storage permissions may differ between APIs. */ }
      return db;
    } catch { return null; }
  })();
  return database;
}

async function read<T>(store: Store, key: string): Promise<T | null> {
  if (session[store].has(key)) return session[store].get(key) as T;
  try {
    const db = await openDatabase();
    if (!db) return null;
    const record = await request(db.transaction(store).objectStore(store).get(key));
    if (!record) return null;
    remember(store, key, record.value);
    return record.value as T;
  } catch { return null; }
}

async function write(store: Store, key: string, value: unknown): Promise<void> {
  remember(store, key, value);
  try {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const entries = tx.objectStore(store);
      entries.put({ key, value, savedAt: Date.now() });
      const count = entries.count();
      count.onsuccess = () => {
        let surplus = count.result - LIMITS[store];
        if (surplus <= 0) return;
        const cursor = entries.index('savedAt').openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result || surplus-- <= 0) return;
          cursor.result.delete();
          cursor.result.continue();
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* The bounded session cache remains usable if disk storage fails. */ }
}

function shelfKey(query: ShelfQuery): string {
  return `${CACHE_VERSION}:${JSON.stringify({ genres: [...query.genres].sort(), year: query.year, type: query.type, stand: query.stand, locale: query.locale, sort: query.sort ?? 'relevance' })}`;
}

export function readLocalShelf(query: ShelfQuery): Promise<ShelfPage | null> {
  return read('shelves', shelfKey(query));
}

export function cacheShelf(query: ShelfQuery, page: ShelfPage): Promise<void> {
  return write('shelves', shelfKey(query), page);
}

export function readLocalTitle(title: DiscoveryTitle, locale: ShelfQuery['locale']): Promise<DiscoveryTitle | null> {
  return read('titles', `${CACHE_VERSION}:${locale}:${title.identity.canonicalKey}`);
}

export function cacheTitle(title: DiscoveryTitle, locale: ShelfQuery['locale']): Promise<void> {
  return write('titles', `${CACHE_VERSION}:${locale}:${title.identity.canonicalKey}`, title);
}

function seriesEpisodesKey(seriesId: string): string {
  return `${CACHE_VERSION}:${seriesId}`;
}

function cachedReleaseDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizedCachedEpisodes(value: unknown): SeriesEpisodes | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rawSeasons = (value as { seasons?: unknown }).seasons;
  if (!Array.isArray(rawSeasons) || rawSeasons.length === 0 || rawSeasons.length > 60) return null;

  const seasons: SeriesEpisodes['seasons'] = [];
  let previousSeason = -1;
  let episodeCount = 0;
  for (const rawGroup of rawSeasons) {
    if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) return null;
    const group = rawGroup as { season?: unknown; episodes?: unknown };
    if (typeof group.season !== 'number' || !Number.isSafeInteger(group.season)
      || group.season < 0 || group.season <= previousSeason || !Array.isArray(group.episodes)
      || group.episodes.length === 0) return null;

    const episodes: BoundedEpisode[] = [];
    let previousEpisode = 0;
    for (const rawEpisode of group.episodes) {
      if (!rawEpisode || typeof rawEpisode !== 'object' || Array.isArray(rawEpisode)) return null;
      const candidate = rawEpisode as Partial<BoundedEpisode>;
      if (candidate.season !== group.season || typeof candidate.episode !== 'number'
        || !Number.isSafeInteger(candidate.episode) || candidate.episode <= previousEpisode) return null;
      if (candidate.name !== undefined && (typeof candidate.name !== 'string'
        || candidate.name.length === 0 || candidate.name.length > 120 || candidate.name.trim() !== candidate.name)) return null;
      if (candidate.released !== undefined && !cachedReleaseDate(candidate.released)) return null;
      // Stored context must be the bounded plain-text form: a record carrying
      // anything else (a number, empty text) is rejected rather than trusted.
      const overview = candidate.overview === undefined ? undefined : boundedOverview(candidate.overview);
      if (candidate.overview !== undefined && !overview) return null;

      const episode: BoundedEpisode = { season: group.season, episode: candidate.episode };
      if (candidate.name !== undefined) episode.name = candidate.name;
      if (candidate.released !== undefined) episode.released = candidate.released;
      if (overview !== undefined) episode.overview = overview;
      episodes.push(episode);
      previousEpisode = candidate.episode;
      episodeCount += 1;
      if (episodeCount > 1_500) return null;
    }
    seasons.push({ season: group.season, episodes });
    previousSeason = group.season;
  }
  return { seasons };
}

export async function readLocalSeriesEpisodes(seriesId: string): Promise<SeriesEpisodes | null> {
  if (!isSeriesImdbId(seriesId)) return null;
  return normalizedCachedEpisodes(await read('seriesEpisodes', seriesEpisodesKey(seriesId)));
}

export function cacheSeriesEpisodes(seriesId: string, episodes: SeriesEpisodes): Promise<void> {
  if (!isSeriesImdbId(seriesId)) return Promise.resolve();
  const normalized = normalizedCachedEpisodes(episodes);
  return normalized ? write('seriesEpisodes', seriesEpisodesKey(seriesId), normalized) : Promise.resolve();
}

function progressKey(seriesId: string): string {
  return `progress:${seriesId}`;
}

function episodeIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? null : value;
}

function boundedWatched(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, timestamp]) => {
      if (!/^[1-9][0-9]*:[1-9][0-9]*$/.test(key)) return [];
      const iso = isoTimestamp(timestamp);
      return iso ? [[key, iso] as const] : [];
    })
    .sort(([, left], [, right]) => right.localeCompare(left))
    .slice(0, MAX_WATCHED_EPISODES)
    .reduce<Record<string, string>>((watched, [key, timestamp]) => {
      watched[key] = timestamp;
      return watched;
    }, {});
}

function normalizeProgressRecord(value: unknown, expectedSeriesId?: string): ProgressRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ProgressRecord>;
  if (!isSeriesImdbId(candidate.seriesId) || (expectedSeriesId && candidate.seriesId !== expectedSeriesId)) return null;
  const season = episodeIndex(candidate.season);
  const episode = episodeIndex(candidate.episode);
  const updatedAt = isoTimestamp(candidate.updatedAt);
  if (season === null || episode === null || !updatedAt) return null;
  const storedKey = (value as { key?: unknown }).key;
  if (storedKey !== undefined && storedKey !== progressKey(candidate.seriesId)) return null;
  return { seriesId: candidate.seriesId, season, episode, watched: boundedWatched(candidate.watched), updatedAt };
}

export async function readSeriesProgress(seriesId: string): Promise<ProgressRecord | null> {
  if (!isSeriesImdbId(seriesId)) return null;
  try {
    const db = await openDatabase();
    if (!db) return null;
    return normalizeProgressRecord(
      await request(db.transaction('progress').objectStore('progress').get(progressKey(seriesId))),
      seriesId,
    );
  } catch { return null; }
}

export async function writeSeriesProgress(record: ProgressRecord): Promise<void> {
  const normalized = normalizeProgressRecord(record);
  if (!normalized) throw new Error('Invalid series progress');
  try {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('progress', 'readwrite');
      tx.objectStore('progress').put({ key: progressKey(normalized.seriesId), ...normalized });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* Progress remains optional when IndexedDB is unavailable. */ }
}

export async function setEpisodeWatched(
  seriesId: string,
  episode: Pick<BoundedEpisode, 'season' | 'episode'>,
  watched: boolean,
  now = new Date(),
): Promise<ProgressRecord | null> {
  if (!isSeriesImdbId(seriesId) || episodeIndex(episode.season) === null || episodeIndex(episode.episode) === null
    || Number.isNaN(now.getTime())) return null;
  const timestamp = now.toISOString();
  const current = await readSeriesProgress(seriesId);
  const nextWatched = { ...(current?.watched ?? {}) };
  const key = `${episode.season}:${episode.episode}`;
  if (watched) nextWatched[key] = timestamp;
  else delete nextWatched[key];
  const next: ProgressRecord = {
    seriesId,
    season: episode.season,
    episode: episode.episode,
    watched: boundedWatched(nextWatched),
    updatedAt: timestamp,
  };
  await writeSeriesProgress(next);
  return next;
}

// One season at a time: the same per-episode progress keys the single toggle
// writes, applied in a single read-modify-write so a season never becomes N
// sequential guess-and-write cycles. The stored pointer ends at the last
// affected episode when marking, so "continue" moves past the season, and at
// the first one when unmarking, so the cleared season stays reachable.
export async function setSeasonWatched(
  seriesId: string,
  season: number,
  episodes: readonly Pick<BoundedEpisode, 'season' | 'episode'>[],
  watched: boolean,
  now = new Date(),
): Promise<ProgressRecord | null> {
  if (!isSeriesImdbId(seriesId) || episodeIndex(season) === null
    || Number.isNaN(now.getTime()) || episodes.length === 0) return null;
  const ordered = [...episodes]
    .filter((episode) => episode.season === season && episodeIndex(episode.episode) !== null)
    .sort((left, right) => left.episode - right.episode);
  if (ordered.length !== episodes.length) return null;

  const timestamp = now.toISOString();
  const current = await readSeriesProgress(seriesId);
  const nextWatched = { ...(current?.watched ?? {}) };
  for (const episode of ordered) {
    const key = `${season}:${episode.episode}`;
    if (watched) nextWatched[key] = timestamp;
    else delete nextWatched[key];
  }
  const next: ProgressRecord = {
    seriesId,
    season,
    episode: (watched ? ordered[ordered.length - 1] : ordered[0]).episode,
    watched: boundedWatched(nextWatched),
    updatedAt: timestamp,
  };
  await writeSeriesProgress(next);
  return next;
}

export async function clearSeriesProgress(seriesId: string): Promise<void> {
  if (!isSeriesImdbId(seriesId)) return;
  try {
    const db = await openDatabase();
    if (!db) return;
    await request(db.transaction('progress', 'readwrite').objectStore('progress').delete(progressKey(seriesId)));
  } catch { /* Local progress clearing is best effort when IndexedDB is unavailable. */ }
}

export async function readAllSeriesProgress(): Promise<ProgressRecord[]> {
  try {
    const db = await openDatabase();
    if (!db) return [];
    return (await request(db.transaction('progress').objectStore('progress').getAll()))
      .map((record) => normalizeProgressRecord(record))
      .filter((record): record is ProgressRecord => record !== null);
  } catch { return []; }
}

export async function writeAllSeriesProgress(records: readonly ProgressRecord[]): Promise<void> {
  const normalized = records.map((record) => normalizeProgressRecord(record));
  if (normalized.some((record) => record === null)) throw new Error('Invalid series progress');
  try {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('progress', 'readwrite');
      const store = tx.objectStore('progress');
      for (const record of normalized as ProgressRecord[]) {
        store.put({ key: progressKey(record.seriesId), ...record });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* Progress remains optional when IndexedDB is unavailable. */ }
}

export async function clearAllSeriesProgress(): Promise<void> {
  try {
    const db = await openDatabase();
    if (!db) return;
    await request(db.transaction('progress', 'readwrite').objectStore('progress').clear());
  } catch { /* Local progress clearing is best effort when IndexedDB is unavailable. */ }
}

export async function clearLocalCache(): Promise<void> {
  session.shelves.clear();
  session.titles.clear();
  session.seriesEpisodes.clear();
  try {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['shelves', 'titles', 'seriesEpisodes', 'progress'], 'readwrite');
      tx.objectStore('shelves').clear();
      tx.objectStore('titles').clear();
      tx.objectStore('seriesEpisodes').clear();
      tx.objectStore('progress').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* Session data was still cleared when IndexedDB is unavailable. */ }
}
