import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { resolveTitleMedia, type MediaResolution } from '../media/resolutionService';
import type { StreamCandidate } from '../media/types';
import { toStremioPlayableStream } from '../media/stremioStream';
import { useStremioVideo } from '../media/useStremioVideo';
import { readMediaConfiguration } from '../platform/nativeBridge';
import { Modal } from './Modal';

interface WatchFlowProps {
  title: DiscoveryTitle;
  locale: Locale;
  mpvVersion: string | null;
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

export function WatchFlow({ title, locale, mpvVersion, onClose }: WatchFlowProps) {
  const t = copy[locale];
  const video = useStremioVideo(mpvVersion);
  const [resolution, setResolution] = useState<MediaResolution | null>(null);
  const [manualVisible, setManualVisible] = useState(false);
  const [lookupState, setLookupState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const play = useCallback(async (candidate: StreamCandidate) => {
    const stream = toStremioPlayableStream(candidate);
    if (!stream) {
      setManualVisible(true);
      return;
    }
    setCandidateId(candidate.stableId);
    setStopped(false);
    try {
      await video.load(stream);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : String(error));
      setManualVisible(true);
    }
  }, [video.load]);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    void (async () => {
      try {
        const addons = await readMediaConfiguration();
        if (controller.signal.aborted) return;
        const result = await resolveTitleMedia(title, addons, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResolution(result);
        setLookupState('ready');
        const winner = result.quickWatch?.winner;
        if (winner && toStremioPlayableStream(winner)) {
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
  }, [locale, play, title]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    video.unload();
    onClose();
  }, [onClose, video.unload]);

  const candidates = resolution?.manualCandidates ?? [];
  const current = resolution?.candidates.find((candidate) => candidate.stableId === candidateId) ?? null;
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

      <div ref={video.containerRef} className="stremio-video-surface" aria-hidden="true" />

      {candidateId && (
        <section className="player-controls" aria-label={locale === 'pt-BR' ? 'Controles do player' : 'Player controls'}>
          <button type="button" onClick={() => video.seekRelative(-10)}>−10s</button>
          <button type="button" onClick={() => video.setPaused(!video.state.paused)}>{video.state.paused ? '▶' : 'Ⅱ'}</button>
          <button type="button" onClick={() => video.seekRelative(10)}>+10s</button>
          <button type="button" onClick={() => { video.unload(); setStopped(true); }}>■ {locale === 'pt-BR' ? 'Parar' : 'Stop'}</button>
          <span>{Math.floor((video.state.time ?? 0) / 1000)}s / {video.state.duration ? `${Math.floor(video.state.duration / 1000)}s` : '—'}</span>
        </section>
      )}

      {resolution?.quickWatch?.winner && !playable(resolution.quickWatch.winner) && (
        <p className="transport-warning">
          {locale === 'pt-BR'
            ? 'A melhor opção usa um transporte externo não suportado. Nenhuma reprodução foi iniciada.'
            : 'The best option uses an unsupported external transport. Playback was not started.'}
        </p>
      )}

      {(manualVisible || phase === 'failed') && candidates.length > 0 && (
        <section className="manual-picker">
          <div className="manual-picker-heading">
            <h3>{locale === 'pt-BR' ? 'Escolher outra fonte' : 'Choose another source'}</h3>
            <span>{candidates.length}</span>
          </div>
          <ol>
            {candidates.map((candidate) => (
              <li key={candidate.stableId}>
                <button type="button" disabled={!playable(candidate)} onClick={() => void play(candidate)}>
                  <strong>{candidate.resolution ? `${candidate.resolution}p` : '—'} · {candidate.sourceName}</strong>
                  <span>{formatBytes(candidate.sizeBytes, locale)} · {candidate.seeders ?? '—'} seeders</span>
                  <small>{playable(candidate) ? candidate.displayName : (locale === 'pt-BR' ? 'Transporte ainda indisponível' : 'Transport not available yet')}</small>
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
