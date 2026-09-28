import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import type { Locale } from '../locadora/catalog';
import { resolveTitleMedia, type MediaResolution } from '../media/resolutionService';
import type { StreamCandidate } from '../media/types';
import { toStremioPlayableStream } from '../media/stremioStream';
import { resolveTitleSubtitles, type StremioExtraSubtitleTrack } from '../media/subtitleResolution';
import { normalizeSubtitleLanguage } from '../media/subtitles';
import { readSubtitleDelay, writeSubtitleDelay, videoDelayIdentity } from '../media/subtitleDelayStore';
import { useStremioVideo } from '../media/useStremioVideo';
import { readMediaConfiguration } from '../platform/nativeBridge';
import { filterSources, type ResolutionFilter } from '../media/sourcePicker';
import { Modal } from './Modal';
import { PlayerIcon } from './PlayerIcon';

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
  if (!resolution) return locale === 'pt-BR' ? 'Encontrando uma fonte para sua sessão.' : 'Finding a source for your screening.';
  const messages: Record<MediaResolution['status'], { 'pt-BR': string; 'en-US': string }> = {
    resolved: { 'pt-BR': 'Sua fonte está pronta.', 'en-US': 'Your source is ready.' },
    'manual-selection-required': { 'pt-BR': 'Quick Watch não escolheu com segurança. Selecione uma fonte.', 'en-US': 'Quick Watch could not choose safely. Select a source.' },
    'identity-unmapped': { 'pt-BR': 'Este título ainda não tem um IMDb confirmado.', 'en-US': 'This title does not have a confirmed IMDb identity yet.' },
    'no-configured-stream-addons': { 'pt-BR': 'Configure uma fonte de mídia com streams nos Ajustes.', 'en-US': 'Configure a media source with streams in Settings.' },
    'no-sources': { 'pt-BR': 'As fontes configuradas não retornaram opções para este título.', 'en-US': 'Configured sources returned no options for this title.' },
    cancelled: { 'pt-BR': 'Busca cancelada.', 'en-US': 'Lookup cancelled.' },
  };
  return messages[resolution.status][locale];
}

export function WatchFlow({ title, locale, mpvVersion, quickWatchEnabled, onClose }: WatchFlowProps) {
  const video = useStremioVideo(mpvVersion);
  const [resolution, setResolution] = useState<MediaResolution | null>(null);
  const [resolutionFilter, setResolutionFilter] = useState<ResolutionFilter>('all');
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsFocused = useRef(false);
  const controlsHovered = useRef(false);
  const [manualVisible, setManualVisible] = useState(false);
  const [tracksVisible, setTracksVisible] = useState(false);
  const [lookupState, setLookupState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [showOtherSubtitles, setShowOtherSubtitles] = useState(false);
  const [subtitlesLoading, setSubtitlesLoading] = useState(true);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const externalSubtitlesRef = useRef<StremioExtraSubtitleTrack[]>([]);
  const tracksButtonRef = useRef<HTMLButtonElement>(null);
  const sourcesButtonRef = useRef<HTMLButtonElement>(null);

  const play = useCallback(async (candidate: StreamCandidate) => {
    const stream = toStremioPlayableStream(candidate);
    if (!stream) {
      setManualVisible(true);
      return;
    }
    setCandidateId(candidate.stableId);
    setManualVisible(false);
    setSeekDraft(null);
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
  const filteredCandidates = filterSources(candidates, resolutionFilter);
  const availableResolutions = [...new Set(candidates.map((candidate) => candidate.resolution))]
    .sort((a, b) => (b ?? -1) - (a ?? -1));
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
    : [...preferredSubtitleOptions, ...otherSubtitleOptions.filter((track) => track.id === (track.extra ? video.state.selectedExtraSubtitlesTrackId : video.state.selectedSubtitlesTrackId))];
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
    if (!candidateId || !selectedSubtitleId || !Number.isFinite(milliseconds)) return;
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
        || target instanceof HTMLButtonElement
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
    if (!candidateId || video.state.ended || video.state.error || !video.state.loaded) return;
    const onPlaybackKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLButtonElement
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
  }, [candidateId, video.setFullscreen, video.setPaused, video.seekRelative, video.state.fullscreen, video.state.loaded, video.state.paused, video.state.ended, video.state.error]);

  useEffect(() => {
    if (video.state.ended && video.state.fullscreen) video.setFullscreen(false);
  }, [video.setFullscreen, video.state.ended, video.state.fullscreen]);
  const playerError = video.state.error ?? lookupError;
  const phase = lookupState === 'loading'
    ? 'loading-streams'
    : playerError
      ? 'failed'
      : video.state.ended
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
  const active = Boolean(candidateId && !video.state.ended);
  const canControl = active && video.state.loaded && !playerError;
  const duration = Math.max(0, video.state.duration ?? 0);
  const position = Math.min(duration, Math.max(0, seekDraft ?? video.state.time ?? 0));
  const percent = (value: number) => duration ? `${Math.min(100, Math.max(0, value / duration * 100))}%` : '0%';
  const toggleTracks = () => { setTracksVisible(!tracksVisible); setManualVisible(false); };
  const toggleSources = () => { setManualVisible(!manualVisible); setTracksVisible(false); };
  const panelOpen = manualVisible || tracksVisible;
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (video.state.fullscreen && canControl && !video.state.paused && !panelOpen && !controlsFocused.current && !controlsHovered.current) {
      hideControlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  }, [video.state.fullscreen, video.state.paused, canControl, panelOpen]);
  useEffect(() => {
    revealControls();
    return () => { if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current); };
  }, [revealControls]);
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [controlsVisible, panelOpen, video.state.fullscreen]);
  const closePanel = () => {
    (tracksVisible ? tracksButtonRef : sourcesButtonRef).current?.focus();
    setManualVisible(false);
    setTracksVisible(false);
  };
  const delay = selectedSubtitleIsExtra ? video.state.extraSubtitlesDelay : video.state.subtitlesDelay;
  const seek = (milliseconds: number) => {
    if (canControl && duration) video.seekTo(Math.max(0, Math.min(duration, milliseconds)));
    setSeekDraft(null);
  };
  const cancel = () => {
    if (video.state.fullscreen) video.setFullscreen(false);
    else if (panelOpen) closePanel();
    else close();
  };
  return (
    <Modal label={`${pt ? 'Assistindo' : 'Watching'} · ${title.name}`} onClose={close} onCancel={cancel} className={`watch-modal${video.state.fullscreen ? ' player-is-fullscreen' : ''}${video.state.fullscreen && !controlsVisible ? ' controls-hidden' : ''}`}
      onPointerMove={(event) => {
        controlsHovered.current = event.target instanceof Element && Boolean(event.target.closest('.cinema-dock, .cinema-header, .cinema-panel'));
        revealControls();
      }} onKeyDown={revealControls}
      onFocusCapture={(event) => { controlsFocused.current = event.target !== event.currentTarget && event.target instanceof Element && event.target.matches(':focus-visible'); revealControls(); }}
      onBlurCapture={(event) => {
        if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) controlsFocused.current = false;
        else controlsFocused.current = event.relatedTarget instanceof Element && event.relatedTarget !== event.currentTarget && event.relatedTarget.matches(':focus-visible');
        revealControls();
      }}>
      <header className="cinema-header">
        <button type="button" className="cinema-icon-button" onClick={close} aria-label={pt ? 'Voltar à locadora' : 'Back to Locadora'} title={pt ? 'Voltar à locadora' : 'Back to Locadora'}><PlayerIcon name="back" /></button>
        <div className="cinema-title"><h2>{title.name}</h2></div>
      </header>
      <div className={`cinema-body${panelOpen ? ' has-panel' : ''}`}>
        <div ref={video.viewportRef} className="cinema-screen" onPointerDown={(event) => { event.currentTarget.closest('dialog')?.focus(); controlsFocused.current = false; revealControls(); }}>
          <div ref={video.containerRef} className="stremio-video-surface"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            aria-label={pt ? `Vídeo de ${title.name}` : `${title.name} video`}
            onDoubleClick={() => { if (canControl) video.setFullscreen(true); }}>
            <div className={`cinema-placeholder${!video.state.loaded || video.state.buffering ? ' is-loading' : ''}`} aria-hidden="true">
              <strong className="brand-logo">WILL'S LOCADORA</strong>
              <span>{phaseLabels[phase][pt ? 0 : 1]}</span>
            </div>
          </div>
        </div>
        {panelOpen && <aside className="cinema-panel" id="cinema-options" aria-label={tracksVisible ? (pt ? 'Áudio e legendas' : 'Audio and subtitles') : (pt ? 'Fontes disponíveis' : 'Available sources')}>
          <div className="cinema-panel-heading"><h3>{tracksVisible ? (pt ? 'Áudio e legendas' : 'Audio & subtitles') : (pt ? 'Escolha uma fonte' : 'Choose a source')}</h3>
            <button type="button" className="cinema-icon-button" onClick={closePanel} aria-label={pt ? 'Fechar opções' : 'Close options'}><PlayerIcon name="close" /></button></div>
          {tracksVisible ? <section className="track-controls">
              {video.state.audioTracks.length > 1 && (
                <label>
                  <span>{locale === 'pt-BR' ? 'Áudio' : 'Audio'}</span>
                  <select
                    value={video.state.selectedAudioTrackId ?? ''}
                    disabled={!canControl}
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
                    disabled={!canControl || video.state.subtitleLoading}
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
                  <button type="button" disabled={!canControl} onClick={() => changeSubtitleDelay(delay - 500)}>{pt ? 'Antes' : 'Earlier'} −0.5s</button>
                  <input
                    type="number"
                    min="-600"
                    max="600"
                    step="0.25"
                    value={delay / 1_000}
                    disabled={!canControl}
                    aria-label={locale === 'pt-BR' ? 'Atraso da legenda em segundos' : 'Subtitle delay in seconds'}
                    onChange={(event) => changeSubtitleDelay(event.currentTarget.valueAsNumber * 1_000)}
                  />
                  <button type="button" disabled={!canControl} onClick={() => changeSubtitleDelay(delay + 500)}>{pt ? 'Depois' : 'Later'} +0.5s</button>
                  <button type="button" disabled={!canControl} onClick={() => changeSubtitleDelay(0)}>{locale === 'pt-BR' ? 'Zerar' : 'Reset'}</button>
                  <small>{pt ? 'Legenda atrasada? Use “Antes”. Adiantada? Use “Depois”. Atalhos: [ e ]' : 'Subtitles late? Use “Earlier”. Too early? Use “Later”. Shortcuts: [ and ]'}</small>
                </div>
              )}
          {subtitlesLoading && <p role="status">{pt ? 'Buscando legendas…' : 'Finding subtitles…'}</p>}
          {video.state.subtitleLoading && <p role="status">{pt ? 'Carregando legenda no player…' : 'Loading subtitle into player…'}</p>}
          {!subtitlesLoading && subtitleOptions.length === 0 && video.state.loaded && <p>{pt ? 'Nenhuma legenda encontrada nas fontes configuradas.' : 'No subtitles found in configured sources.'}</p>}
          {video.state.subtitleError && <p role="alert">{pt ? 'Não foi possível aplicar a legenda ou sincronia. Tente selecionar novamente; legendas externas precisam de HTTPS e formato SRT, VTT ou ASS.' : 'Could not apply subtitle or sync. Try selecting again; external subtitles require HTTPS and SRT, VTT or ASS format.'}</p>}
          </section> : <section className="manual-picker">
          <p>{pt ? 'Troque de fonte se a reprodução estiver instável.' : 'Switch sources if playback is unstable.'}</p>
          <label className="source-resolution"><span>{pt ? 'Resolução' : 'Resolution'}</span>
            <select value={resolutionFilter} onChange={(event) => setResolutionFilter(event.target.value as ResolutionFilter)}>
              <option value="all">{pt ? 'Todas as resoluções' : 'All resolutions'}</option>
              {availableResolutions.map((value) => <option key={value ?? 'unknown'} value={value ?? 'unknown'}>{value ? `${value}p` : (pt ? 'Desconhecida' : 'Unknown')}</option>)}
            </select>
          </label>
          <p>{pt ? 'Mais seeds primeiro' : 'Most seeds first'}</p>
          <ol aria-label={pt ? 'Fontes disponíveis' : 'Available sources'}>
            {filteredCandidates.map((candidate) => (
              <li key={candidate.stableId}>
                <button
                  type="button"
                  aria-current={candidate.stableId === candidateId ? 'true' : undefined}
                  disabled={!playable(candidate) || (candidate.stableId === candidateId && active && !playerError)}
                  onClick={() => void play(candidate)}
                >
                  <strong>{candidate.resolution ? `${candidate.resolution}p` : '—'} · {candidate.sourceName}</strong>
                  <span>{formatBytes(candidate.sizeBytes, locale)} · {candidate.seeders ?? '—'} seeders</span>
                  <small>{candidate.stableId === candidateId
                    ? (active ? (pt ? 'Fonte atual' : 'Current source') : (pt ? 'Reproduzir novamente' : 'Play again'))
                    : playable(candidate)
                      ? candidate.displayName
                      : (locale === 'pt-BR' ? 'Transporte ainda indisponível' : 'Transport not available yet')}</small>
                </button>
              </li>
            ))}
          </ol>
          </section>}
        </aside>}
      </div>
      <section className="cinema-dock" aria-label={pt ? 'Controles do player' : 'Player controls'}>
        <div className="cinema-status-row">
          <span className={`player-phase phase-${phase}`} role="status">{phaseLabels[phase][pt ? 0 : 1]}</span>
          <span className="cinema-buffer">{active && !playerError && `${Math.floor(bufferedAhead / 1000)}s ${pt ? 'em buffer' : 'buffered'}`}</span>
          {lookupState === 'loading' && <button type="button" onClick={close}>{pt ? 'Cancelar' : 'Cancel'}</button>}
        </div>
        {(playerError || !candidateId && lookupState !== 'loading') && <div className="cinema-feedback" role={playerError ? 'alert' : 'status'}>
          <p>{playerError ?? explanation(resolution, locale)}</p>
          {playerError && current && <button type="button" onClick={() => void play(current)}>{pt ? 'Tentar novamente' : 'Try again'}</button>}
        </div>}
        <div className="cinema-timeline" style={{ '--played': percent(position), '--buffered': percent(video.state.buffered ?? 0) } as CSSProperties}>
          <input type="range" aria-label={pt ? 'Posição do vídeo' : 'Playback position'} min="0" max={duration} step="1000"
            disabled={!canControl || !duration} value={position} aria-valuetext={`${clockTime(position)} / ${clockTime(duration)}`}
            onChange={(event) => setSeekDraft(event.currentTarget.valueAsNumber)}
            onPointerDown={(event) => event.currentTarget.setPointerCapture?.(event.pointerId)}
            onPointerUp={(event) => seek(event.currentTarget.valueAsNumber)}
            onPointerCancel={() => setSeekDraft(null)} onBlur={() => setSeekDraft(null)}
            onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) seek(event.currentTarget.valueAsNumber); }} />
        </div>
        <div className="cinema-transport">
          <div className="cinema-transport-group">
            <button type="button" className="cinema-icon-button cinema-play" disabled={!current || Boolean(playerError) || active && !video.state.loaded}
              aria-label={!active ? (pt ? 'Reproduzir novamente' : 'Play again') : video.state.paused ? (pt ? 'Continuar' : 'Resume') : (pt ? 'Pausar' : 'Pause')}
              onClick={() => { if (!active && current) void play(current); else video.setPaused(!video.state.paused); }}>
              <PlayerIcon name={!active ? 'replay' : video.state.paused ? 'play' : 'pause'} /></button>
            <button type="button" className="cinema-icon-button" disabled={!canControl} aria-label={pt ? 'Voltar 10 segundos' : 'Back 10 seconds'} title="← · 10s" onClick={() => video.seekRelative(-10)}><PlayerIcon name="rewind" /></button>
            <button type="button" className="cinema-icon-button" disabled={!canControl} aria-label={pt ? 'Avançar 10 segundos' : 'Forward 10 seconds'} title="→ · 10s" onClick={() => video.seekRelative(10)}><PlayerIcon name="forward" /></button>
            <span className="cinema-time">{clockTime(position)} <span>/ {clockTime(duration)}</span></span>
          </div>
          <div className="cinema-transport-group cinema-tools">
            <div className="cinema-volume"><button type="button" className="cinema-icon-button" disabled={!canControl} aria-label={video.state.muted ? (pt ? 'Ativar som' : 'Unmute') : (pt ? 'Silenciar' : 'Mute')} onClick={() => video.setMuted(!video.state.muted)}><PlayerIcon name={video.state.muted || video.state.volume === 0 ? 'mute' : 'volume'} /></button>
              <input type="range" min="0" max="100" aria-label="Volume" disabled={!canControl} value={video.state.muted ? 0 : video.state.volume} onChange={(event) => video.setVolume(event.currentTarget.valueAsNumber)} /></div>
            <button ref={tracksButtonRef} type="button" className="cinema-panel-button" aria-expanded={tracksVisible} aria-controls={tracksVisible ? 'cinema-options' : undefined} onClick={toggleTracks}><PlayerIcon name="tracks" /><span>{pt ? 'Áudio e legendas' : 'Audio & subtitles'}</span></button>
            <button ref={sourcesButtonRef} type="button" className="cinema-panel-button" disabled={!candidates.length} aria-expanded={manualVisible} aria-controls={manualVisible ? 'cinema-options' : undefined} onClick={toggleSources}><PlayerIcon name="sources" /><span>{pt ? 'Fontes' : 'Sources'}</span></button>
            <button type="button" className="cinema-icon-button" disabled={!canControl} aria-label={pt ? 'Tela cheia' : 'Fullscreen'} title={pt ? 'Tela cheia · F · Esc para voltar' : 'Fullscreen · F · Escape to return'} onClick={() => video.setFullscreen(true)}><PlayerIcon name="fullscreen" /></button>
          </div>
        </div>
      </section>
    </Modal>
  );
}
