export interface MemberTitle {
  id: string;
  canonicalKey: string;
  tmdbId: number;
  type: 'movie' | 'series';
  name: string;
  year: number | null;
  unavailable: boolean;
  rentedAt: string | null;
  returnedAt: string | null;
  watchedStatus: 'watched' | 'not_watched' | null;
}

export interface MemberProfile {
  userId: string;
  username: string;
  createdAt: string | null;
}

export interface MemberState {
  profile: MemberProfile | null;
  activeRental: { id: string; items: MemberTitle[] } | null;
  history: MemberTitle[];
  historyHasMore: boolean;
  collections: {
    watchLater: MemberTitle[];
    favorites: MemberTitle[];
  };
}

const MAX_COLLECTION_ITEMS = 500;
const MAX_HISTORY_ITEMS = 100;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function optionalDate(value: unknown): string | null {
  return boundedString(value, 64);
}

function normalizeTitle(value: unknown): MemberTitle | null {
  const item = record(value);
  if (!item) return null;
  const type = item.type === 'movie' || item.type === 'series' ? item.type : null;
  const tmdbId = typeof item.tmdbId === 'number' && Number.isSafeInteger(item.tmdbId) && item.tmdbId > 0
    ? item.tmdbId
    : null;
  const name = boundedString(item.name, 240);
  if (!type || tmdbId === null || !name) return null;
  const canonicalKey = boundedString(item.canonicalKey, 180) ?? `${type}:${tmdbId}`;
  const year = typeof item.year === 'number' && Number.isSafeInteger(item.year) && item.year >= 1870 && item.year <= 2200
    ? item.year
    : null;
  const watchedStatus = item.watchedStatus === 'watched' || item.watchedStatus === 'not_watched'
    ? item.watchedStatus
    : null;
  return {
    id: boundedString(item.id, 180) ?? canonicalKey,
    canonicalKey,
    tmdbId,
    type,
    name,
    year,
    unavailable: item.unavailable === true,
    rentedAt: optionalDate(item.rentedAt),
    returnedAt: optionalDate(item.returnedAt),
    watchedStatus,
  };
}

function normalizeTitles(value: unknown, limit: number): MemberTitle[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map(normalizeTitle).filter((item): item is MemberTitle => item !== null);
}

export function normalizeMemberState(value: unknown): MemberState {
  const state = record(value) ?? {};
  const profileValue = record(state.profile);
  const userId = boundedString(profileValue?.userId, 160);
  const username = boundedString(profileValue?.username, 24);
  const profile = userId && username ? {
    userId,
    username,
    createdAt: optionalDate(profileValue?.createdAt),
  } : null;

  const rentalValue = record(state.activeRental);
  const rentalId = boundedString(rentalValue?.id, 180);
  const rentalItems = normalizeTitles(rentalValue?.items, 3);
  const activeRental = rentalId && rentalItems.length ? { id: rentalId, items: rentalItems } : null;
  const collectionsValue = record(state.collections);

  return {
    profile,
    activeRental,
    history: normalizeTitles(state.history, MAX_HISTORY_ITEMS),
    historyHasMore: state.historyHasMore === true,
    collections: {
      watchLater: normalizeTitles(collectionsValue?.watch_later, MAX_COLLECTION_ITEMS),
      favorites: normalizeTitles(collectionsValue?.favorite, MAX_COLLECTION_ITEMS),
    },
  };
}
