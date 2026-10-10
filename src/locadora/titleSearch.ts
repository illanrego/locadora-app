import { normalizeDiscoveryTitle, type DiscoveryTitle, type PublicTitlePayload } from '../domain/content';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function artwork(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 500) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'image.tmdb.org'
      && url.pathname.startsWith('/t/p/') && !url.username && !url.password
      && !url.search && !url.hash ? url.href : undefined;
  } catch { return undefined; }
}

export function normalizeTitleSearch(body: unknown): DiscoveryTitle[] | null {
  const response = record(body);
  if (!response || !Array.isArray(response.titles)) return null;
  const seen = new Set<string>();
  return response.titles.slice(0, 12).flatMap((value) => {
    const item = record(value);
    if (!item) return [];
    const id = typeof item.id === 'string' && /^tmdb:[1-9]\d{0,15}$/.test(item.id) ? item.id : null;
    const name = boundedText(item.name, 200);
    if (!id || !name || !['movie', 'series'].includes(String(item.type))) return [];
    const payload: PublicTitlePayload = {
      id,
      type: item.type as string,
      name,
      year: item.year as string | number | null,
      imdbId: typeof item.imdbId === 'string' && /^tt\d{5,12}$/.test(item.imdbId) ? item.imdbId : undefined,
      poster: artwork(item.poster),
      background: artwork(item.background),
      description: boundedText(item.description, 2000),
      imdbRating: typeof item.imdbRating === 'string' || typeof item.imdbRating === 'number' ? item.imdbRating : undefined,
      genres: Array.isArray(item.genres) ? item.genres.slice(0, 6) : [],
    };
    const title = normalizeDiscoveryTitle(payload);
    if (!title || seen.has(title.identity.canonicalKey)) return [];
    seen.add(title.identity.canonicalKey);
    return [title];
  });
}
