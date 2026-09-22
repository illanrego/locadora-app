import { externalId, type DiscoveryTitle } from '../domain/content';
import {
  fetchConfiguredAddonResource,
  type ConfiguredAddon,
} from '../platform/nativeBridge';
import { stableHash } from './hash';
import { normalizeSubtitleTracks } from './subtitles';

export interface StremioExtraSubtitleTrack {
  id: string;
  url: string;
  lang: string;
  label: string;
  origin: string;
  embedded: false;
}

type ConfiguredResourceFetcher = typeof fetchConfiguredAddonResource;

export async function resolveTitleSubtitles(
  title: DiscoveryTitle,
  addons: ConfiguredAddon[],
  options: { signal?: AbortSignal; fetcher?: ConfiguredResourceFetcher } = {},
): Promise<StremioExtraSubtitleTrack[]> {
  const imdbId = externalId(title.identity, 'imdb');
  if (!imdbId || title.identity.type !== 'movie' || options.signal?.aborted) return [];
  const subtitleAddons = addons.filter((addon) => addon.supportsSubtitles);
  const fetcher = options.fetcher ?? fetchConfiguredAddonResource;
  const settled = await Promise.allSettled(subtitleAddons.map(async (addon) => {
    const body = await fetcher({
      addonId: addon.id,
      resource: 'subtitles',
      contentType: 'movie',
      id: imdbId,
    });
    if (!body || typeof body !== 'object') return [];
    return normalizeSubtitleTracks((body as { subtitles?: unknown }).subtitles).map((track) => ({
      id: `ADDON_${stableHash(`${addon.id}:${track.id}:${track.url}`)}`,
      url: track.url,
      lang: track.language,
      label: track.label,
      origin: addon.name,
      embedded: false as const,
    }));
  }));
  if (options.signal?.aborted) return [];
  return settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []).slice(0, 256);
}
