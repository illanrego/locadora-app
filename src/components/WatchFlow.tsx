import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { resolveTitleMedia, type MediaResolution } from '../media/resolutionService';
import type { StreamCandidate } from '../media/types';
import { toStremioPlayableStream } from '../media/stremioStream';
import { resolveTitleSubtitles, type StremioExtraSubtitleTrack } from '../media/subtitleResolution';
import { normalizeSubtitleLanguage } from '../media/subtitles';
import { readSubtitleDelay, writeSubtitleDelay, videoDelayIdentity } from '../media/subtitleDelayStore';
import { useStremioVideo } from '../media/useStremioVideo';
import { readMediaConfiguration } from '../platform/nativeBridge';
import { Modal } from './Modal';

interface WatchFlowProps {
  title: DiscoveryTitle;
  locale: Locale;
  mpvVersion: string | null;
  quickWatchEnabled: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number | null, locale: Locale): string {
  if (bytes === null) return locale === 'pt-BR' ? 'tamanho desconhecido' : 'unknown size';
  const gibibytes = bytes / 1024 ** 3;
  return gibibytes >= 1
    ? `${gibibytes.toLocaleString(locale, { maximumFractionDigits: 1 })} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function playable(candidate: StreamCandidate): boolean {
  return toStremioPlayableStream(candidate) !== null;
}

function clockTime(milliseconds: number | null): string {
  const seconds = Math.max(0, Math.floor((milliseconds ?? 0) / 1000));
  return `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function explanation(resolution: MediaResolution | null, locale: Locale): string {
  if (!resolution) return locale === 'pt-BR' ? 'Preparando o caixa…' : 'Preparing the counter…';
  const messages: Record<MediaResolution['status'], { 'pt-BR': string; 'en-US': string }> = {
    resolved: { 'pt-BR': 'Quick Watch encontrou uma fonte determinística.', 'en-US': 'Quick Watch found a deterministic source.' },
    'manual-selection-required': { 'pt-BR': 'Quick Watch não escolheu com segurança. Selecione uma fonte.', 'en-US': 'Quick Watch could not choose safely. Select a source.' },
    'identity-unmapped': { 'pt-BR': 'Este título ainda não tem um IMDb confirmado.', 'en-US': 'This title does not have a confirmed IMDb identity yet.' },
    'no-configured-stream-addons': { 'pt-BR': 'Configure uma fonte de mídia com streams nos Ajustes.', 'en-US': 'Configure a media source with streams in Settings.' },
    'no-sources': { 'pt-BR': 'As fontes configuradas não retornaram opções para este título.', 'en-US': 'Configured sources returned no options for this title.' },
    cancelled: { 'pt-BR': 'Busca cancelada.', 'en-US': 'Lookup cancelled.' },
  };
  return messages[resolution.status][locale];
}

export function WatchFlow({ title, locale, mpvVersion, quickWatchEnabled, onClose }: WatchFlowProps) {
  const t = copy[locale];
  const video = useStremioVideo(mpvVersion);
  const [resolution, setResolution] = useState<MediaResolution | null>(null);
  const [manualVisible, setManualVisible] = useState(false);
  const [lookupState, setLookupState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [showOtherSubtitles, setShowOtherSubtitles] = useState(false);
  const [subtitlesLoading, setSubtitlesLoading] = useState(true);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const externalSubtitlesRef = useRef<StremioExtraSubtitleTrack[]>([]);

  const play = useCallback(async (candidate: StreamCandidate) => {
    const stream = toStremioPlayableStream(candidate);
    if (!stream) {
      setManualVisible(true);
      return;
    }
    setCandidateId(candidate.stableId);
    setStopped(false);
    setLookupError(null);
    try {
      await video.load(stream);
      video.addExtraSubtitlesTracks(externalSubtitlesRef.current);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : String(error));
      setManualVisible(true);
    }
  }, [video.addExtraSubtitlesTracks, video.load]);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    void (async () => {
      try {
        const addons = await readMediaConfiguration();
        if (controller.signal.aborted) return;
        setSubtitlesLoading(true);
        void resolveTitleSubtitles(title, addons, { signal: controller.signal }).then((subtitles) => {
          if (controller.signal.aborted) return;
          externalSubtitlesRef.current = subtitles;
          video.addExtraSubtitlesTracks(subtitles);
          setSubtitlesLoading(false);
        }).catch(() => { if (!controller.signal.aborted) setSubtitlesLoading(false); });
        const result = await resolveTitleMedia(title, addons, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResolution(result);
        setLookupState('ready');
        const winner = result.quickWatch?.winner;
        if (quickWatchEnabled && winner && toStremioPlayableStream(winner)) {
          await play(winner);
        } else if (result.status === 'manual-selection-required' || winner) {
          setManualVisible(true);
        } else if (!['cancelled'].includes(result.status)) {
          setLookupState('failed');
          setLookupError(explanation(result, locale));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setLookupState('failed');
          setLookupError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [locale, play, quickWatchEnabled, title, video.addExtraSubtitlesTracks]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    video.unload();
    onClose();
  }, [onClose, video.unload]);

  const candidates = resolution?.manualCandidates ?? [];
  const current = resolution?.candidates.find((candidate) => candidate.stableId === candidateId) ?? null;
  const delayIdentity = videoDelayIdentity(current);
  const subtitleOptions = [
    ...video.state.subtitlesTracks.map((track) => ({ ...track, extra: false })),
    ...video.state.extraSubtitlesTracks.map((track) => ({ ...track, extra: true })),
  ];
  const preferredSubtitleOptions = subtitleOptions.filter((track) => normalizeSubtitleLanguage(track.lang) !== 'other')
    .sort((a, b) => Number(normalizeSubtitleLanguage(a.lang) === 'en') - Number(normalizeSubtitleLanguage(b.lang) === 'en'));
  const otherSubtitleOptions = subtitleOptions.filter((track) => normalizeSubtitleLanguage(track.lang) === 'other');
  const visibleSubtitleOptions = showOtherSubtitles
    ? [...preferredSubtitleOptions, ...otherSubtitleOptions]
    : [...preferredSubtitleOptions, ...otherSubtitleOptions.filter((track) => track.id === video.state.selectedSubtitlesTrackId)];
  const selectedSubtitleId = video.state.selectedExtraSubtitlesTrackId ?? video.state.selectedSubtitlesTrackId;
  const selectedSubtitleIsExtra = Boolean(video.state.selectedExtraSubtitlesTrackId);

  useEffect(() => {
    if (!selectedSubtitleId) return;
    video.setSubtitleDelay(
      delayIdentity ? readSubtitleDelay(delayIdentity, selectedSubtitleId) : 0,
      selectedSubtitleIsExtra,
    );
  }, [delayIdentity, selectedSubtitleId, selectedSubtitleIsExtra, video.setSubtitleDelay]);

  const changeSubtitleDelay = useCallback((milliseconds: number) => {
    if (!candidateId || !selectedSubtitleId) return;
    video.setSubtitleDelay(milliseconds, selectedSubtitleIsExtra);
    if (delayIdentity) writeSubtitleDelay(delayIdentity, selectedSubtitleId, milliseconds);
  }, [candidateId, delayIdentity, selectedSubtitleId, selectedSubtitleIsExtra, video.setSubtitleDelay]);

  useEffect(() => {
    if (!selectedSubtitleId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable)) return;
      const currentDelay = selectedSubtitleIsExtra
        ? video.state.extraSubtitlesDelay
        : video.state.subtitlesDelay;
      if (event.key === '[') {
        event.preventDefault();
        changeSubtitleDelay(currentDelay - 500);
      } else if (event.key === ']') {
        event.preventDefault();
        changeSubtitleDelay(currentDelay + 500);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeSubtitleDelay, selectedSubtitleId, selectedSubtitleIsExtra, video.state.extraSubtitlesDelay, video.state.subtitlesDelay]);

  useEffect(() => {
    if (!candidateId) return;
    const onPlaybackKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (event.key === 'Escape' && video.state.fullscreen) {
        event.preventDefault();
        video.setFullscreen(false);
      } else if (event.key === 'f' || event.key === 'F11') {
        event.preventDefault();
        video.setFullscreen(!video.state.fullscreen);
      } else if (event.key === ' ' && video.state.loaded) {
        event.preventDefault();
        video.setPaused(!video.state.paused);
      } else if (event.key === 'ArrowLeft' && video.state.loaded) {
        event.preventDefault();
        video.seekRelative(-10);
      } else if (event.key === 'ArrowRight' && video.state.loaded) {
        event.preventDefault();
        video.seekRelative(10);
      }
    };
    window.addEventListener('keydown', onPlaybackKey);
    return () => window.removeEventListener('keydown', onPlaybackKey);
  }, [candidateId, video.setFullscreen, video.setPaused, video.seekRelative, video.state.fullscreen, video.state.loaded, video.state.paused]);

  useEffect(() => {
    if (video.state.ended && video.state.fullscreen) video.setFullscreen(false);
  }, [video.setFullscreen, video.state.ended, video.state.fullscreen]);
  const playerError = video.state.error ?? lookupError;
  const phase = lookupState === 'loading'
    ? 'loading-streams'
    : playerError
      ? 'failed'
      : stopped || video.state.ended
        ? 'ended'
        : candidateId && (!video.state.loaded || (video.state.buffering && !video.state.paused))
          ? 'buffering'
          : video.state.loaded && video.state.paused
            ? 'paused'
            : video.state.loaded
              ? 'playing'
              : 'applying-quick-watch';
  const phaseLabels: Record<string, [string, string]> = {
    'loading-streams': ['Buscando fontes…', 'Finding sources…'],
    buffering: ['Preparando vídeo…', 'Buffering…'],
    playing: ['Reproduzindo', 'Playing'], paused: ['Pausado', 'Paused'],
    ended: ['Reprodução encerrada', 'Playback stopped'], failed: ['Não foi possível reproduzir', 'Playback failed'],
    'applying-quick-watch': ['Escolha uma fonte', 'Choose a source'],
  };
  const pt = locale === 'pt-BR';
  const bufferedAhead = Math.max(0, (video.state.buffered ?? 0) - (video.state.time ?? 0));
  return (
    <Modal label={`Quick Watch · ${title.name}`} onClose={close} className={`watch-modal${video.state.fullscreen ? ' player-is-fullscreen' : ''}`}>
      <header className="panel-header">
        <p className="eyebrow">Quick Watch · movie-v1</p>
        <h2>{title.name}</h2>
        <button type="button" className="dialog-close" onClick={close} aria-label={t.close}>×</button>
      </header>

      <section className="watch-status" aria-live="polite">
        <span className={`player-phase phase-${phase}`}>{phaseLabels[phase][pt ? 0 : 1]}</span>
        <p>{playerError ?? explanation(resolution, locale)}</p>
        {current && <p className="current-source">{current.resolution}p · {formatBytes(current.sizeBytes, locale)} · {current.seeders ?? '—'} seeders · {current.sourceName}</p>}
      </section>

      {!quickWatchEnabled && resolution?.quickWatch?.winner && (
        <p className="transport-warning">
          {locale === 'pt-BR'
            ? 'Quick Watch automático está desligado. Escolha a fonte avaliada abaixo.'
            : 'Automatic Quick Watch is off. Choose an evaluated source below.'}
        </p>
      )}

      {playerError && current && (
        <button type="button" className="retry-playback" onClick={() => void play(current)}>
          {locale === 'pt-BR' ? 'Tentar esta fonte novamente' : 'Retry this source'}
        </button>
      )}

      <div
        ref={video.containerRef}
        className="stremio-video-surface"
        role="application"
        aria-label={pt ? `Reprodutor de ${title.name}` : `${title.name} player`}
        onDoubleClick={() => video.setFullscreen(true)}
      >
        <span>{phaseLabels[phase][pt ? 0 : 1]}</span>
      </div>

      {candidateId && (
        <>
          <p className="playback-window-note">{pt ? 'O filme toca aqui. Duplo clique ou F abre a tela cheia; Esc volta aos controles.' : 'The movie plays here. Double-click or press F for fullscreen; Escape returns to controls.'}</p>
          <div className="playback-timeline">
            <label htmlFor="playback-seek">{pt ? 'Posição do vídeo' : 'Playback position'}</label>
            <input id="playback-seek" type="range" min="0" max={video.state.duration ?? 0} step="1000"
              disabled={!video.state.loaded || !video.state.duration}
              value={seekDraft ?? video.state.time ?? 0}
              aria-valuetext={clockTime(seekDraft ?? video.state.time)}
              onChange={(event) => setSeekDraft(event.currentTarget.valueAsNumber)}
              onPointerUp={(event) => { video.seekTo(event.currentTarget.valueAsNumber); setSeekDraft(null); }}
              onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) { video.seekTo(event.currentTarget.valueAsNumber); setSeekDraft(null); } }} />
            <div><span>{clockTime(seekDraft ?? video.state.time)} / {clockTime(video.state.duration)}</span>
              <span>{pt ? 'Em buffer' : 'Buffered'}: {Math.floor(bufferedAhead / 1000)}s</span></div>
            {phase === 'buffering' && <p role="status">{pt ? 'Aguardando dados da fonte. Você pode trocar a fonte abaixo ou cancelar.' : 'Waiting for source data. You can switch sources below or cancel.'}</p>}
          </div>
          <section className="player-controls" aria-label={locale === 'pt-BR' ? 'Controles do player' : 'Player controls'}>
            <button type="button" onClick={() => video.seekRelative(-10)}>−10s</button>
            <button type="button" onClick={() => video.setPaused(!video.state.paused)}>{video.state.paused ? (pt ? '▶ Continuar' : '▶ Resume') : (pt ? 'Ⅱ Pausar' : 'Ⅱ Pause')}</button>
            <button type="button" onClick={() => video.seekRelative(10)}>+10s</button>
            <button type="button" onClick={() => video.setFullscreen(!video.state.fullscreen)}>
              {video.state.fullscreen ? (pt ? 'Sair da tela cheia' : 'Exit fullscreen') : (pt ? 'Tela cheia' : 'Fullscreen')}
            </button>
            <button type="button" onClick={() => { video.unload(); setStopped(true); }}>■ {locale === 'pt-BR' ? 'Parar' : 'Stop'}</button>
          </section>

          {(video.state.audioTracks.length > 1 || subtitleOptions.length > 0 || subtitlesLoading) && (
            <section className="track-controls" aria-label={locale === 'pt-BR' ? 'Áudio e legendas' : 'Audio and subtitles'}>
              {video.state.audioTracks.length > 1 && (
                <label>
                  <span>{locale === 'pt-BR' ? 'Áudio' : 'Audio'}</span>
                  <select
                    value={video.state.selectedAudioTrackId ?? ''}
                    onChange={(event) => video.selectAudioTrack(event.currentTarget.value)}
                  >
                    {video.state.audioTracks.map((track) => (
                      <option key={track.id} value={track.id}>{track.label || track.lang}</option>
                    ))}
                  </select>
                </label>
              )}
              {subtitleOptions.length > 0 && (
                <label>
                  <span>{locale === 'pt-BR' ? 'Legenda' : 'Subtitles'}</span>
                  <select
                    disabled={!video.state.loaded || video.state.subtitleLoading}
                    value={video.state.selectedExtraSubtitlesTrackId
                      ? `extra:${video.state.selectedExtraSubtitlesTrackId}`
                      : video.state.selectedSubtitlesTrackId
                        ? `embedded:${video.state.selectedSubtitlesTrackId}`
                        : ''}
                    onChange={(event) => {
                      const [kind, ...id] = event.currentTarget.value.split(':');
                      video.selectSubtitleTrack(id.join(':') || null, kind === 'extra');
                    }}
                  >
                    <option value="">{locale === 'pt-BR' ? 'Desligada' : 'Off'}</option>
                    {visibleSubtitleOptions.map((track) => (
                      <option key={`${track.extra}:${track.id}`} value={`${track.extra ? 'extra' : 'embedded'}:${track.id}`}>
                        {track.lang} · {track.label || track.lang}{track.extra ? ` · ${track.origin ?? (pt ? 'Externa' : 'External')}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!showOtherSubtitles && otherSubtitleOptions.length > 0 && (
                <button type="button" className="other-subtitles" onClick={() => setShowOtherSubtitles(true)}>
                  {locale === 'pt-BR' ? `Outros idiomas (${otherSubtitleOptions.length})` : `Other languages (${otherSubtitleOptions.length})`}
                </button>
              )}
              {(video.state.selectedSubtitlesTrackId || video.state.selectedExtraSubtitlesTrackId) && (
                <div className="subtitle-delay" aria-label={locale === 'pt-BR' ? 'Atraso da legenda' : 'Subtitle delay'}>
                  <span>{locale === 'pt-BR' ? 'Sincronia da legenda' : 'Subtitle sync'}</span>
                  <button type="button" onClick={() => changeSubtitleDelay((video.state.selectedExtraSubtitlesTrackId ? video.state.extraSubtitlesDelay : video.state.subtitlesDelay) - 500)}>{pt ? 'Aparecer antes' : 'Show earlier'} −0.5s</button>
                  <input
                    type="number"
                    min="-600"
                    max="600"
                    step="0.25"
                    value={(video.state.selectedExtraSubtitlesTrackId ? video.state.extraSubtitlesDelay : video.state.subtitlesDelay) / 1_000}
                    aria-label={locale === 'pt-BR' ? 'Atraso da legenda em segundos' : 'Subtitle delay in seconds'}
                    onChange={(event) => changeSubtitleDelay(event.currentTarget.valueAsNumber * 1_000)}
                  />
                  <button type="button" onClick={() => changeSubtitleDelay(0)}>{locale === 'pt-BR' ? 'Zerar' : 'Reset'}</button>
                  <button type="button" onClick={() => changeSubtitleDelay((video.state.selectedExtraSubtitlesTrackId ? video.state.extraSubtitlesDelay : video.state.subtitlesDelay) + 500)}>{pt ? 'Aparecer depois' : 'Show later'} +0.5s</button>
                  <small>{pt ? 'Legenda atrasada? Use “Aparecer antes”. Adiantada? Use “Aparecer depois”. Atalhos: [ e ]' : 'Subtitles late? Use “Show earlier”. Too early? Use “Show later”. Shortcuts: [ and ]'}</small>
                </div>
              )}
            </section>
          )}
          {subtitlesLoading && <p role="status">{pt ? 'Buscando legendas…' : 'Finding subtitles…'}</p>}
          {video.state.subtitleLoading && <p role="status">{pt ? 'Carregando legenda no player…' : 'Loading subtitle into player…'}</p>}
          {!subtitlesLoading && subtitleOptions.length === 0 && video.state.loaded && <p>{pt ? 'Nenhuma legenda encontrada nas fontes configuradas.' : 'No subtitles found in configured sources.'}</p>}
          {video.state.subtitleError && <p role="alert">{pt ? 'Não foi possível aplicar a legenda ou sincronia. Tente selecionar novamente; legendas externas precisam de HTTPS e formato SRT, VTT ou ASS.' : 'Could not apply subtitle or sync. Try selecting again; external subtitles require HTTPS and SRT, VTT or ASS format.'}</p>}
        </>
      )}

      {resolution?.quickWatch?.winner && !playable(resolution.quickWatch.winner) && (
        <p className="transport-warning">
          {locale === 'pt-BR'
            ? 'A melhor opção usa um transporte externo não suportado. Nenhuma reprodução foi iniciada.'
            : 'The best option uses an unsupported external transport. Playback was not started.'}
        </p>
      )}

      {(candidates.length > 0) && (
        <section className="manual-picker">
          <div className="manual-picker-heading">
            <h3>{locale === 'pt-BR' ? 'Fontes disponíveis' : 'Available sources'}</h3>
            <span>{candidates.length}</span>
          </div>
          <ol>
            {candidates.map((candidate) => (
              <li key={candidate.stableId}>
                <button
                  type="button"
                  aria-current={candidate.stableId === candidateId ? 'true' : undefined}
                  disabled={!playable(candidate) || (candidate.stableId === candidateId && !stopped && !video.state.ended && !playerError)}
                  onClick={() => void play(candidate)}
                >
                  <strong>{candidate.resolution ? `${candidate.resolution}p` : '—'} · {candidate.sourceName}</strong>
                  <span>{formatBytes(candidate.sizeBytes, locale)} · {candidate.seeders ?? '—'} seeders</span>
                  <small>{candidate.stableId === candidateId
                    ? (locale === 'pt-BR' ? 'Tocando agora' : 'Playing now')
                    : playable(candidate)
                      ? candidate.displayName
                      : (locale === 'pt-BR' ? 'Transporte ainda indisponível' : 'Transport not available yet')}</small>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {lookupState === 'loading' && (
        <button type="button" className="cancel-watch" onClick={close}>{locale === 'pt-BR' ? 'Cancelar busca' : 'Cancel lookup'}</button>
      )}
    </Modal>
  );
}
