import {
  fetchConfiguredAddonResource,
  type ConfiguredAddon,
} from '../platform/nativeBridge';
import type { Locale } from '../locadora/catalog';
import { cacheSeriesEpisodes, readLocalSeriesEpisodes } from '../locadora/localCache';
import { isSeriesImdbId, parseSeriesEpisodes, type SeriesEpisodes } from './seriesEpisodes';

export type NoEpisodeListReason =
  | 'no-imdb-id'
  | 'no-meta-addon'
  | 'addon-failure'
  | 'malformed-payload'
  | 'empty-list';

export type SeriesEpisodeListResult =
  | { status: 'available'; episodes: SeriesEpisodes }
  | { status: 'no-episode-list'; reason: NoEpisodeListReason };

export function episodeListMessage(reason: NoEpisodeListReason, locale: Locale): string {
  const messages: Record<NoEpisodeListReason, [string, string]> = {
    'no-imdb-id': ['Esta série não tem um ID IMDb confirmado para buscar episódios.', 'This series has no confirmed IMDb ID for episode lookup.'],
    'no-meta-addon': ['Nenhuma fonte de metadados de episódios está configurada.', 'No episode metadata source is configured.'],
    'addon-failure': ['Não foi possível carregar os episódios da fonte de metadados.', 'Could not load episodes from the metadata source.'],
    'malformed-payload': ['A fonte de metadados enviou uma lista de episódios inválida.', 'The metadata source returned an invalid episode list.'],
    'empty-list': ['Ainda não há episódios disponíveis para esta série.', 'No episodes are available for this series yet.'],
  };
  return messages[reason][locale === 'pt-BR' ? 0 : 1];
}

export async function fetchSeriesEpisodes(
  imdbId: string | null,
  addons: readonly ConfiguredAddon[],
  fetcher: typeof fetchConfiguredAddonResource = fetchConfiguredAddonResource,
): Promise<SeriesEpisodeListResult> {
  if (!isSeriesImdbId(imdbId)) return { status: 'no-episode-list', reason: 'no-imdb-id' };
  const cached = await readLocalSeriesEpisodes(imdbId);
  if (cached) return { status: 'available', episodes: cached };
  // The status summary exposes declared resource names. Native code checks the
  // manifest's series type and tt prefix for this exact request.
  const candidates = addons.filter((addon) => addon.resources.includes('meta'));
  if (!candidates.length) return { status: 'no-episode-list', reason: 'no-meta-addon' };

  let malformed = false;
  for (const addon of candidates) {
    try {
      const payload = await fetcher({ addonId: addon.id, resource: 'meta', contentType: 'series', id: imdbId });
      const videos = payload !== null && typeof payload === 'object'
        && 'meta' in payload && payload.meta !== null && typeof payload.meta === 'object'
        && 'videos' in payload.meta ? payload.meta.videos : undefined;
      if (!Array.isArray(videos)) {
        malformed = true;
        continue;
      }
      const episodes = parseSeriesEpisodes(payload);
      if (episodes.seasons.length) {
        await cacheSeriesEpisodes(imdbId, episodes);
        return { status: 'available', episodes };
      }
      if (videos.length) {
        malformed = true;
        continue;
      }
      return { status: 'no-episode-list', reason: 'empty-list' };
    } catch {
      // Native failure details may include a private manifest URL. Do not surface them.
    }
  }
  return { status: 'no-episode-list', reason: malformed ? 'malformed-payload' : 'addon-failure' };
}
