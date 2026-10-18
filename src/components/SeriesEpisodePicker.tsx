import { useEffect, useMemo, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { externalId } from '../domain/content';
import type { Locale } from '../locadora/catalog';
import { readSeriesProgress, setEpisodeWatched, type ProgressRecord } from '../locadora/localCache';
import { episodesForSeason, nextEpisode, type BoundedEpisode } from '../media/seriesEpisodes';
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
  const [progress, setProgress] = useState<ProgressRecord | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [progressPending, setProgressPending] = useState<string | null>(null);
  const pt = locale === 'pt-BR';
  const imdbId = externalId(title.identity, 'imdb');

  useEffect(() => {
    let current = true;
    setResult(null);
    setProgress(null);
    setSelectedSeason(null);
    void (async () => {
      try {
        const [addons, storedProgress] = await Promise.all([
          readMediaConfiguration(),
          imdbId ? readSeriesProgress(imdbId) : Promise.resolve(null),
        ]);
        const next = await fetchSeriesEpisodes(imdbId, addons);
        if (!current) return;
        setProgress(storedProgress);
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
  const watched = useMemo(() => new Set(Object.keys(progress?.watched ?? {})), [progress]);
  const hasWatched = watched.size > 0;
  const continueEpisode = result?.status === 'available'
    ? nextEpisode(
        result.episodes,
        watched,
        hasWatched && progress ? { season: progress.season, episode: progress.episode } : undefined,
      )
    : null;
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
        {continueEpisode ? <button type="button" className="tape-primary" disabled={!canWatch}
          onClick={() => onSelect(continueEpisode)}>
          {hasWatched ? (pt ? 'Continuar' : 'Continue') : (pt ? 'Começar' : 'Start')} {episodeLabel(continueEpisode)}
        </button> : hasWatched && <p>{pt ? 'Série concluída.' : 'Series complete.'}</p>}
        <label>
          <span>{pt ? 'Temporada' : 'Season'}</span>
          <select value={selectedSeason ?? ''} onChange={(event) => setSelectedSeason(Number(event.currentTarget.value))}>
            {seasons.map(({ season }) => <option value={season} key={season}>
              {pt ? `Temporada ${season}` : `Season ${season}`}
            </option>)}
          </select>
        </label>
        {episodes.length ? <ul>
          {episodes.map((episode) => {
            const key = `${episode.season}:${episode.episode}`;
            const isWatched = watched.has(key);
            return <li key={key}>
            <button type="button" disabled={!canWatch}
              aria-label={`${episodeLabel(episode)}${episode.name ? ` · ${episode.name}` : ''}`}
              onClick={() => onSelect(episode)}>
              <strong>{episodeLabel(episode)}</strong>
              {episode.name && <span>{episode.name}</span>}
            </button>
            <button type="button" className="episode-watched-toggle" aria-pressed={isWatched}
              aria-label={`${isWatched ? (pt ? 'Assistido' : 'Watched') : (pt ? 'Marcar como assistido' : 'Mark watched')} ${episodeLabel(episode)}`}
              disabled={!imdbId || progressPending === key}
              onClick={() => {
                if (!imdbId) return;
                setProgressPending(key);
                void setEpisodeWatched(imdbId, episode, !isWatched)
                  .then(setProgress)
                  .finally(() => setProgressPending((pending) => pending === key ? null : pending));
              }}>
              {isWatched ? (pt ? 'Assistido' : 'Watched') : (pt ? 'Marcar como assistido' : 'Mark watched')}
            </button>
          </li>;
          })}
        </ul> : <p>{episodeListMessage('empty-list', locale)}</p>}
      </>}
    </section>
  );
}
