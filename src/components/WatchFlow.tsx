import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { INITIAL_PLAYER_STATE, reducePlayerState } from '../media/playerMachine';
import { resolveTitleMedia, type MediaResolution } from '../media/resolutionService';
import type { StreamCandidate } from '../media/types';
import {
  controlNativePlayer,
  loadNativePlayer,
  readMediaConfiguration,
  readNativePlayerEvents,
  shutdownNativePlayer,
  startNativePlayer,
} from '../platform/nativeBridge';
import { Modal } from './Modal';

interface WatchFlowProps {
  title: DiscoveryTitle;
  locale: Locale;
  onClose: () => void;
}

function formatBytes(bytes: number | null, locale: Locale): string {
  if (bytes === null) return locale === 'pt-BR' ? 'tamanho desconhecido' : 'unknown size';
  const gibibytes = bytes / 1024 ** 3;
  return gibibytes >= 1
    ? `${gibibytes.toLocaleString(locale, { maximumFractionDigits: 1 })} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;
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

function playable(candidate: StreamCandidate): candidate is StreamCandidate & { playbackDescriptor: { kind: 'url'; url: string } } {
  return candidate.playbackDescriptor.kind === 'url' && candidate.transportType === 'http';
}

export function WatchFlow({ title, locale, onClose }: WatchFlowProps) {
  const t = copy[locale];
  const [player, dispatch] = useReducer(reducePlayerState, INITIAL_PLAYER_STATE);
  const [resolution, setResolution] = useState<MediaResolution | null>(null);
  const [manualVisible, setManualVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [playerActive, setPlayerActive] = useState(false);
  const playerStarted = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const play = useCallback(async (candidate: StreamCandidate) => {
    if (!playable(candidate)) {
      setManualVisible(true);
      return;
    }
    dispatch({ type: 'SOURCE_SELECTED', candidateId: candidate.stableId });
    try {
      await startNativePlayer();
      playerStarted.current = true;
      setPlayerActive(true);
      await loadNativePlayer(candidate.playbackDescriptor.url);
    } catch (error) {
      dispatch({ type: 'FAILED', message: error instanceof Error ? error.message : String(error) });
      setManualVisible(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: 'SELECT_TITLE', titleKey: title.identity.canonicalKey });
    void (async () => {
      try {
        const addons = await readMediaConfiguration();
        if (controller.signal.aborted) return;
        dispatch({ type: 'IDENTITY_RESOLVED' });
        const result = await resolveTitleMedia(title, addons, { signal: controller.signal });
        if (controller.signal.aborted) return;
        dispatch({ type: 'STREAMS_LOADED' });
        dispatch({ type: 'CANDIDATES_NORMALIZED' });
        setResolution(result);
        const winner = result.quickWatch?.winner;
        if (winner && playable(winner)) {
          await play(winner);
        } else if (result.status === 'manual-selection-required' || winner) {
          setManualVisible(true);
        } else if (!['cancelled'].includes(result.status)) {
          dispatch({ type: 'FAILED', message: explanation(result, locale) });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          dispatch({ type: 'FAILED', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => {
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [locale, play, title]);

  useEffect(() => {
    if (!playerActive || !['buffering', 'playing', 'paused'].includes(player.phase)) return;
    const interval = window.setInterval(() => {
      void readNativePlayerEvents().then((events) => {
        for (const event of events) {
          switch (event.kind) {
            case 'file-loaded': dispatch({ type: 'FILE_LOADED' }); break;
            case 'playing': setPaused(false); dispatch({ type: 'PLAYING' }); break;
            case 'paused': setPaused(true); dispatch({ type: 'PAUSED' }); break;
            case 'position': dispatch({ type: 'POSITION', seconds: event.value }); break;
            case 'duration': dispatch({ type: 'DURATION', seconds: event.value }); break;
            case 'ended': dispatch({ type: 'ENDED' }); break;
            case 'failed': dispatch({ type: 'FAILED', message: event.value }); break;
            default: break;
          }
        }
      }).catch((error: unknown) => dispatch({ type: 'FAILED', message: error instanceof Error ? error.message : String(error) }));
    }, 250);
    return () => window.clearInterval(interval);
  }, [player.phase, playerActive]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    if (playerStarted.current) void shutdownNativePlayer();
    onClose();
  }, [onClose]);

  const control = async (action: 'pause' | 'resume' | 'seek' | 'stop', seconds?: number) => {
    try {
      await controlNativePlayer(action, seconds);
      if (action === 'stop') dispatch({ type: 'ENDED' });
    } catch (error) {
      dispatch({ type: 'FAILED', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const candidates = resolution?.manualCandidates ?? [];
  const current = resolution?.candidates.find((candidate) => candidate.stableId === player.candidateId) ?? null;
  return (
    <Modal label={`Quick Watch · ${title.name}`} onClose={close} className="watch-modal">
      <header className="panel-header">
        <p className="eyebrow">Quick Watch · movie-v1</p>
        <h2>{title.name}</h2>
        <button type="button" className="dialog-close" onClick={close} aria-label={t.close}>×</button>
      </header>

      <section className="watch-status" aria-live="polite">
        <span className={`player-phase phase-${player.phase}`}>{player.phase}</span>
        <p>{player.error ?? explanation(resolution, locale)}</p>
        {current && <p className="current-source">{current.resolution}p · {formatBytes(current.sizeBytes, locale)} · {current.seeders ?? '—'} seeders · {current.sourceName}</p>}
      </section>

      {['buffering', 'playing', 'paused', 'ended'].includes(player.phase) && (
        <section className="player-controls" aria-label={locale === 'pt-BR' ? 'Controles do player' : 'Player controls'}>
          <button type="button" onClick={() => void control('seek', -10)}>−10s</button>
          <button type="button" onClick={() => void control(paused ? 'resume' : 'pause')}>{paused ? '▶' : 'Ⅱ'}</button>
          <button type="button" onClick={() => void control('seek', 10)}>+10s</button>
          <button type="button" onClick={() => void control('stop')}>■ {locale === 'pt-BR' ? 'Parar' : 'Stop'}</button>
          <span>{Math.floor(player.positionSeconds)}s / {player.durationSeconds ? `${Math.floor(player.durationSeconds)}s` : '—'}</span>
        </section>
      )}

      {resolution?.quickWatch?.winner && !playable(resolution.quickWatch.winner) && (
        <p className="transport-warning">
          {locale === 'pt-BR'
            ? 'A melhor opção é torrent e ainda precisa do resolvedor de transporte. Nenhuma reprodução foi iniciada.'
            : 'The best option is a torrent and still needs the transport resolver. Playback was not started.'}
        </p>
      )}

      {(manualVisible || player.phase === 'failed') && candidates.length > 0 && (
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

      {['resolving-identity', 'loading-streams', 'normalizing-candidates', 'applying-quick-watch'].includes(player.phase) && (
        <button type="button" className="cancel-watch" onClick={close}>{locale === 'pt-BR' ? 'Cancelar busca' : 'Cancel lookup'}</button>
      )}
    </Modal>
  );
}
