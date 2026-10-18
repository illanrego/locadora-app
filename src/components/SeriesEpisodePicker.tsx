import { useEffect, useMemo, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { externalId } from '../domain/content';
import type { Locale } from '../locadora/catalog';
import { episodesForSeason, type BoundedEpisode } from '../media/seriesEpisodes';
import {
  episodeListMessage,
  fetchSeriesEpisodes,
  type SeriesEpisodeListResult,
} from '../media/seriesEpisodeService';
import { readMediaConfiguration } from '../platform/nativeBridge';

interface SeriesEpisodePickerProps {
  title: DiscoveryTitle;
  locale: Locale;
  canWatch: boolean;
  onSelect: (episode: BoundedEpisode) => void;
}

function episodeLabel(episode: BoundedEpisode): string {
  return `T${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`;
}

export function SeriesEpisodePicker({ title, locale, canWatch, onSelect }: SeriesEpisodePickerProps) {
  const [result, setResult] = useState<SeriesEpisodeListResult | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const pt = locale === 'pt-BR';
  const imdbId = externalId(title.identity, 'imdb');

  useEffect(() => {
    let current = true;
    setResult(null);
    setSelectedSeason(null);
    void (async () => {
      try {
        const addons = await readMediaConfiguration();
        const next = await fetchSeriesEpisodes(imdbId, addons);
        if (!current) return;
        setResult(next);
        if (next.status === 'available') {
          setSelectedSeason(next.episodes.seasons.find((season) => season.season > 0)?.season ?? null);
        }
      } catch {
        if (current) setResult({ status: 'no-episode-list', reason: 'addon-failure' });
      }
    })();
    return () => { current = false; };
  }, [imdbId]);

  const seasons = useMemo(() => result?.status === 'available'
    ? result.episodes.seasons.filter((season) => season.season > 0)
    : [], [result]);
  const episodes = result?.status === 'available' && selectedSeason !== null
    ? episodesForSeason(result.episodes, selectedSeason)
    : [];
  const unavailableReason = result?.status === 'no-episode-list'
    ? result.reason
    : result?.status === 'available' && !seasons.length
      ? 'empty-list'
      : null;

  return (
    <section className="tape-episodes" aria-label={pt ? 'Episódios da série' : 'Series episodes'}>
      <h2>{pt ? 'Episódios' : 'Episodes'}</h2>
      {!result && <p role="status">{pt ? 'Buscando episódios…' : 'Finding episodes…'}</p>}
      {unavailableReason && <p role="alert">{episodeListMessage(unavailableReason, locale)}</p>}
      {seasons.length > 0 && <>
        <label>
          <span>{pt ? 'Temporada' : 'Season'}</span>
          <select value={selectedSeason ?? ''} onChange={(event) => setSelectedSeason(Number(event.currentTarget.value))}>
            {seasons.map(({ season }) => <option value={season} key={season}>
              {pt ? `Temporada ${season}` : `Season ${season}`}
            </option>)}
          </select>
        </label>
        {episodes.length ? <ul>
          {episodes.map((episode) => <li key={`${episode.season}:${episode.episode}`}>
            <button type="button" disabled={!canWatch}
              aria-label={`${episodeLabel(episode)}${episode.name ? ` · ${episode.name}` : ''}`}
              onClick={() => onSelect(episode)}>
              <strong>{episodeLabel(episode)}</strong>
              {episode.name && <span>{episode.name}</span>}
            </button>
          </li>)}
        </ul> : <p>{episodeListMessage('empty-list', locale)}</p>}
      </>}
    </section>
  );
}
