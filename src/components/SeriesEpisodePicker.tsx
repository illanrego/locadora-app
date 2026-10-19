import { useEffect, useMemo, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { externalId } from '../domain/content';
import type { Locale } from '../locadora/catalog';
import {
  clearSeriesProgress,
  readSeriesProgress,
  setEpisodeWatched,
  setSeasonWatched,
  type ProgressRecord,
} from '../locadora/localCache';
import { episodeLabel, episodesForSeason, nextEpisode, type BoundedEpisode } from '../media/seriesEpisodes';
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

function episodeKey(episode: Pick<BoundedEpisode, 'season' | 'episode'>): string {
  return `${episode.season}:${episode.episode}`;
}

export function SeriesEpisodePicker({ title, locale, canWatch, onSelect }: SeriesEpisodePickerProps) {
  const [result, setResult] = useState<SeriesEpisodeListResult | null>(null);
  const [progress, setProgress] = useState<ProgressRecord | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [progressPending, setProgressPending] = useState<string | null>(null);
  const [showSpecials, setShowSpecials] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const pt = locale === 'pt-BR';
  const imdbId = externalId(title.identity, 'imdb');

  useEffect(() => {
    let current = true;
    setResult(null);
    setProgress(null);
    setSelectedSeason(null);
    setShowSpecials(false);
    setPreviewKey(null);
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

  // Season 0 is specials: hidden until this picker is told to show it.
  const seasons = useMemo(() => result?.status === 'available'
    ? result.episodes.seasons.filter((season) => season.season > 0 || showSpecials)
    : [], [result, showSpecials]);
  const hasSpecials = result?.status === 'available'
    && result.episodes.seasons.some((season) => season.season === 0);
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
    : result?.status === 'available' && !result.episodes.seasons.length
      ? 'empty-list'
      : null;
  // The selected episode for the context block: the one the user is on in this
  // season, defaulting to where "continue" points when it is in this season.
  const previewed = episodes.find((episode) => episodeKey(episode) === previewKey)
    ?? (continueEpisode && continueEpisode.season === selectedSeason ? continueEpisode : null)
    ?? episodes[0]
    ?? null;
  // Season-wide marking uses the same per-episode records as the single toggle.
  // Season 0 stays untracked: local progress keys are normal seasons only.
  const seasonTrackable = selectedSeason !== null && selectedSeason > 0 && episodes.length > 0;
  const seasonWatched = seasonTrackable && episodes.every((episode) => watched.has(episodeKey(episode)));

  const toggleSpecials = () => {
    const next = !showSpecials;
    setShowSpecials(next);
    setPreviewKey(null);
    if (!next && selectedSeason === 0) {
      setSelectedSeason(result?.status === 'available'
        ? result.episodes.seasons.find((season) => season.season > 0)?.season ?? null
        : null);
    }
  };

  const toggleSeason = () => {
    if (!imdbId || selectedSeason === null || !episodes.length) return;
    const pending = `season:${selectedSeason}`;
    setProgressPending(pending);
    void setSeasonWatched(imdbId, selectedSeason, episodes, !seasonWatched)
      .then(setProgress)
      .finally(() => setProgressPending((value) => value === pending ? null : value));
  };

  return (
    <section className="tape-episodes" aria-label={pt ? 'Episódios da série' : 'Series episodes'}>
      <h2>{pt ? 'Episódios' : 'Episodes'}</h2>
      {!result && <p role="status">{pt ? 'Buscando episódios…' : 'Finding episodes…'}</p>}
      {unavailableReason && <p role="alert">{episodeListMessage(unavailableReason, locale)}</p>}
      {hasSpecials && <button type="button" className="episode-specials" aria-pressed={showSpecials}
        onClick={toggleSpecials}>
        {showSpecials ? (pt ? 'Ocultar especiais' : 'Hide specials') : (pt ? 'Mostrar especiais' : 'Show specials')}
      </button>}
      {seasons.length > 0 && <>
        {continueEpisode ? <button type="button" className="tape-primary" disabled={!canWatch}
          onClick={() => onSelect(continueEpisode)}>
          {hasWatched ? (pt ? 'Continuar' : 'Continue') : (pt ? 'Começar' : 'Start')} {episodeLabel(continueEpisode)}
        </button> : hasWatched && <p>{pt ? 'Série concluída.' : 'Series complete.'}</p>}
        {hasWatched && imdbId && <button type="button" className="episode-forget"
          disabled={progressPending !== null}
          onClick={() => {
            setProgressPending('forget');
            void clearSeriesProgress(imdbId)
              .then(() => setProgress(null))
              .finally(() => setProgressPending(null));
          }}>
          {pt ? 'Esquecer progresso' : 'Forget progress'}
        </button>}
        <label>
          <span>{pt ? 'Temporada' : 'Season'}</span>
          <select value={selectedSeason ?? ''} onChange={(event) => {
            setSelectedSeason(Number(event.currentTarget.value));
            setPreviewKey(null);
          }}>
            {seasons.map(({ season }) => <option value={season} key={season}>
              {season === 0
                ? (pt ? 'Especiais (temporada 0)' : 'Specials (season 0)')
                : (pt ? `Temporada ${season}` : `Season ${season}`)}
            </option>)}
          </select>
        </label>
        {seasonTrackable && <button type="button" className="episode-season-toggle" aria-pressed={seasonWatched}
          disabled={!imdbId || progressPending !== null}
          onClick={toggleSeason}>
          {seasonWatched
            ? (pt ? `Desmarcar temporada ${selectedSeason}` : `Unmark season ${selectedSeason}`)
            : (pt ? `Marcar temporada ${selectedSeason} como assistida` : `Mark season ${selectedSeason} watched`)}
        </button>}
        {episodes.length ? <ul>
          {episodes.map((episode) => {
            const key = episodeKey(episode);
            const isWatched = watched.has(key);
            return <li key={key}>
            <button type="button" disabled={!canWatch}
              aria-label={`${episodeLabel(episode)}${episode.name ? ` · ${episode.name}` : ''}`}
              onFocus={() => setPreviewKey(key)}
              onClick={() => onSelect(episode)}>
              <strong>{episodeLabel(episode)}</strong>
              {episode.name && <span>{episode.name}</span>}
            </button>
            {episode.season > 0 && <button type="button" className="episode-watched-toggle" aria-pressed={isWatched}
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
            </button>}
          </li>;
          })}
        </ul> : <p>{episodeListMessage('empty-list', locale)}</p>}
        {previewed && (previewed.released || previewed.overview) && <div className="episode-context"
          aria-label={pt ? 'Contexto do episódio' : 'Episode context'}>
          <strong>{episodeLabel(previewed)}</strong>
          {previewed.released && <span>{pt ? 'Exibido em' : 'Aired'} {previewed.released}</span>}
          {previewed.overview && <p>{previewed.overview}</p>}
        </div>}
      </>}
    </section>
  );
}
