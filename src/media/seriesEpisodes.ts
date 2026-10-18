export interface BoundedEpisode {
  season: number;
  episode: number;
  name?: string;
  released?: string;
}

export interface SeriesEpisodes {
  seasons: Array<{ season: number; episodes: BoundedEpisode[] }>;
}

const MAX_SEASONS = 40;
const MAX_EPISODES = 300;
const MAX_SCANNED_VIDEOS = 3000;
const IMDB_ID = /^tt[0-9]{5,9}$/;

export function isSeriesImdbId(value: unknown): value is string {
  return typeof value === 'string' && IMDB_ID.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function index(value: unknown, minimum: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function releasedDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)
    ? undefined : date.toISOString().slice(0, 10);
}

export function parseSeriesEpisodes(payload: unknown): SeriesEpisodes {
  const meta = record(record(payload)?.meta);
  if (!Array.isArray(meta?.videos)) return { seasons: [] };

  const seasons = new Map<number, BoundedEpisode[]>();
  const seen = new Set<string>();
  let count = 0;
  for (const raw of meta.videos.slice(0, MAX_SCANNED_VIDEOS)) {
    const video = record(raw);
    const season = index(video?.season, 0);
    const episode = index(video?.episode, 1);
    if (season === null || episode === null) continue;
    const key = `${season}:${episode}`;
    if (seen.has(key) || (!seasons.has(season) && seasons.size >= MAX_SEASONS)) continue;
    seen.add(key);
    const bounded: BoundedEpisode = { season, episode };
    if (typeof video?.name === 'string') {
      const name = video.name.trim().slice(0, 120);
      if (name) bounded.name = name;
    } else if (typeof video?.title === 'string') {
      const name = video.title.trim().slice(0, 120);
      if (name) bounded.name = name;
    }
    const released = releasedDate(video?.released);
    if (released) bounded.released = released;
    const group = seasons.get(season) ?? [];
    group.push(bounded);
    seasons.set(season, group);
    count += 1;
    if (count >= MAX_EPISODES) break;
  }
  return {
    seasons: [...seasons.entries()]
      .sort(([a], [b]) => a - b)
      .map(([season, episodes]) => ({ season, episodes: episodes.sort((a, b) => a.episode - b.episode) })),
  };
}

export function episodesForSeason(episodes: SeriesEpisodes, season: number): BoundedEpisode[] {
  return episodes.seasons.find((entry) => entry.season === season)?.episodes ?? [];
}

export function nextEpisode(episodes: SeriesEpisodes, watched: ReadonlySet<string>): BoundedEpisode | null {
  for (const group of episodes.seasons) {
    if (group.season === 0) continue;
    for (const episode of group.episodes) {
      if (!watched.has(`${episode.season}:${episode.episode}`)) return episode;
    }
  }
  return null;
}

export function episodeVideoId(imdbId: string, episode: Pick<BoundedEpisode, 'season' | 'episode'>): string {
  if (!isSeriesImdbId(imdbId) || index(episode.season, 0) === null || index(episode.episode, 1) === null) {
    throw new Error('Invalid episode identity');
  }
  return `${imdbId}:${episode.season}:${episode.episode}`;
}
