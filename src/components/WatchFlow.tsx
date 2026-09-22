import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { resolveTitleMedia, type MediaResolution } from '../media/resolutionService';
import type { StreamCandidate } from '../media/types';
import { toStremioPlayableStream } from '../media/stremioStream';
import { resolveTitleSubtitles, type StremioExtraSubtitleTrack } from '../media/subtitleResolution';
import { normalizeSubtitleLanguage } from '../media/subtitles';
import { readSubtitleDelay, writeSubtitleDelay } from '../media/subtitleDelayStore';
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
        const [result, subtitles] = await Promise.all([
          resolveTitleMedia(title, addons, { signal: controller.signal }),
          resolveTitleSubtitles(title, addons, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        externalSubtitlesRef.current = subtitles;
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
  }, [locale, play, quickWatchEnabled, title]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    video.unload();
    onClose();
  }, [onClose, video.unload]);

  const candidates = resolution?.manualCandidates ?? [];
  const current = resolution?.candidates.find((candidate) => candidate.stableId === candidateId) ?? null;
  const subtitleOptions = [
    ...video.state.subtitlesTracks.map((track) => ({ ...track, extra: false })),
    ...video.state.extraSubtitlesTracks.map((track) => ({ ...track, extra: true })),
  ];
  const preferredSubtitleOptions = subtitleOptions.filter((track) => normalizeSubtitleLanguage(track.lang) !== 'other');
  const otherSubtitleOptions = subtitleOptions.filter((track) => normalizeSubtitleLanguage(track.lang) === 'other');
  const visibleSubtitleOptions = showOtherSubtitles
    ? [...preferredSubtitleOptions, ...otherSubtitleOptions]
    : preferredSubtitleOptions;
  const selectedSubtitleId = video.state.selectedExtraSubtitlesTrackId ?? video.state.selectedSubtitlesTrackId;
  const selectedSubtitleIsExtra = Boolean(video.state.selectedExtraSubtitlesTrackId);

  useEffect(() => {
    if (!candidateId || !selectedSubtitleId) return;
    video.setSubtitleDelay(
      readSubtitleDelay(candidateId, selectedSubtitleId),
      selectedSubtitleIsExtra,
    );
  }, [candidateId, selectedSubtitleId, selectedSubtitleIsExtra, video.setSubtitleDelay]);

  const changeSubtitleDelay = useCallback((milliseconds: number) => {
    if (!candidateId || !selectedSubtitleId) return;
    video.setSubtitleDelay(milliseconds, selectedSubtitleIsExtra);
    writeSubtitleDelay(candidateId, selectedSubtitleId, milliseconds);
  }, [candidateId, selectedSubtitleId, selectedSubtitleIsExtra, video.setSubtitleDelay]);

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
  const playerError = video.state.error ?? lookupError;
  const phase = lookupState === 'loading'
    ? 'loading-streams'
    : playerError
      ? 'failed'
      : stopped || video.state.ended
        ? 'ended'
        : candidateId && !video.state.loaded
          ? 'buffering'
          : video.state.loaded && video.state.paused
            ? 'paused'
            : video.state.loaded
              ? 'playing'
              : 'applying-quick-watch';
  return (
    <Modal label={`Quick Watch · ${title.name}`} onClose={close} className="watch-modal">
      <header className="panel-header">
        <p className="eyebrow">Quick Watch · movie-v1</p>
        <h2>{title.name}</h2>
        <button type="button" className="dialog-close" onClick={close} aria-label={t.close}>×</button>
      </header>

      <section className="watch-status" aria-live="polite">
        <span className={`player-phase phase-${phase}`}>{phase}</span>
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

      {candidateId && externalSubtitlesRef.current.length > 0 && video.state.streamingServiceAvailable === false && (
        <p className="transport-warning">
          {locale === 'pt-BR'
            ? 'As legendas externas precisam do Stremio Service oficial em execução.'
            : 'External subtitles require the official Stremio Service to be running.'}
        </p>
      )}

      <div ref={video.containerRef} className="stremio-video-surface" aria-hidden="true" />

      {candidateId && (
        <>
          <section className="player-controls" aria-label={locale === 'pt-BR' ? 'Controles do player' : 'Player controls'}>
            <button type="button" onClick={() => video.seekRelative(-10)}>−10s</button>
            <button type="button" onClick={() => video.setPaused(!video.state.paused)}>{video.state.paused ? '▶' : 'Ⅱ'}</button>
            <button type="button" onClick={() => video.seekRelative(10)}>+10s</button>
            <button type="button" onClick={() => { video.unload(); setStopped(true); }}>■ {locale === 'pt-BR' ? 'Parar' : 'Stop'}</button>
            <span>{Math.floor((video.state.time ?? 0) / 1000)}s / {video.state.duration ? `${Math.floor(video.state.duration / 1000)}s` : '—'}</span>
          </section>

          {(video.state.audioTracks.length > 1 || subtitleOptions.length > 0) && (
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
                    value={video.state.selectedSubtitlesTrackId
                      ? `embedded:${video.state.selectedSubtitlesTrackId}`
                      : video.state.selectedExtraSubtitlesTrackId
                        ? `extra:${video.state.selectedExtraSubtitlesTrackId}`
                        : ''}
                    onChange={(event) => {
                      const [kind, ...id] = event.currentTarget.value.split(':');
                      video.selectSubtitleTrack(id.join(':') || null, kind === 'extra');
                    }}
                  >
                    <option value="">{locale === 'pt-BR' ? 'Desligada' : 'Off'}</option>
                    {visibleSubtitleOptions.map((track) => (
                      <option key={`${track.extra}:${track.id}`} value={`${track.extra ? 'extra' : 'embedded'}:${track.id}`}>
                        {track.label || track.lang}
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
                  <span>{locale === 'pt-BR' ? 'Sincronia' : 'Sync'}</span>
                  <button type="button" onClick={() => changeSubtitleDelay((video.state.selectedExtraSubtitlesTrackId ? video.state.extraSubtitlesDelay : video.state.subtitlesDelay) - 500)}>−0.5s</button>
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
                  <button type="button" onClick={() => changeSubtitleDelay((video.state.selectedExtraSubtitlesTrackId ? video.state.extraSubtitlesDelay : video.state.subtitlesDelay) + 500)}>+0.5s</button>
                  <small>{locale === 'pt-BR' ? 'Atalhos: [ e ]' : 'Shortcuts: [ and ]'}</small>
                </div>
              )}
            </section>
          )}
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
                  disabled={!playable(candidate) || candidate.stableId === candidateId}
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
