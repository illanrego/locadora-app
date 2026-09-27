import StremioVideo from '@stremio/stremio-video';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { safeDiagnostic } from './redaction';
import { StremioShellTransport } from '../platform/stremioShellTransport';
import { STREMIO_SERVICE_URL, stremioServiceAvailable } from '../platform/stremioService';
import type { StremioPlayableStream } from './stremioStream';
import type { StremioExtraSubtitleTrack } from './subtitleResolution';
import {
  onNativePlayerFullscreenChanged,
  onNativePlayerRenderError,
  selectNativeSubtitle,
  setNativePlayerFullscreen,
  setNativePlayerProperty,
  setNativeVideoBounds,
} from '../platform/nativeBridge';

export interface StremioVideoState {
  loaded: boolean;
  paused: boolean;
  buffering: boolean;
  time: number | null;
  duration: number | null;
  buffered: number | null;
  subtitleLoading: boolean;
  subtitleError: string | null;
  audioTracks: StremioVideoTrack[];
  selectedAudioTrackId: string | null;
  subtitlesTracks: StremioVideoTrack[];
  selectedSubtitlesTrackId: string | null;
  subtitlesDelay: number;
  extraSubtitlesTracks: StremioVideoTrack[];
  selectedExtraSubtitlesTrackId: string | null;
  extraSubtitlesDelay: number;
  streamingServiceAvailable: boolean | null;
  error: string | null;
  ended: boolean;
  fullscreen: boolean;
  volume: number;
  muted: boolean;
}

export interface StremioVideoTrack {
  id: string;
  lang: string;
  label: string;
  origin?: string;
}

const INITIAL_STATE: StremioVideoState = {
  loaded: false,
  paused: false,
  buffering: false,
  time: null,
  duration: null,
  buffered: null,
  subtitleLoading: false,
  subtitleError: null,
  audioTracks: [],
  selectedAudioTrackId: null,
  subtitlesTracks: [],
  selectedSubtitlesTrackId: null,
  subtitlesDelay: 0,
  extraSubtitlesTracks: [],
  selectedExtraSubtitlesTrackId: null,
  extraSubtitlesDelay: 0,
  streamingServiceAvailable: null,
  error: null,
  ended: false,
  fullscreen: false,
  volume: 100,
  muted: false,
};

function stremioVideoError(value: unknown): string {
  if (value && typeof value === 'object' && 'error' in value) {
    return safeDiagnostic((value as { error: unknown }).error);
  }
  return safeDiagnostic(value);
}

export interface StremioVideoController {
  containerRef: RefObject<HTMLDivElement | null>;
  state: StremioVideoState;
  load: (stream: StremioPlayableStream) => Promise<void>;
  unload: () => void;
  setPaused: (paused: boolean) => void;
  seekRelative: (seconds: number) => void;
  seekTo: (milliseconds: number) => void;
  setFullscreen: (fullscreen: boolean) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  selectAudioTrack: (id: string) => void;
  selectSubtitleTrack: (id: string | null, extra: boolean) => void;
  setSubtitleDelay: (milliseconds: number, extra?: boolean) => void;
  addExtraSubtitlesTracks: (tracks: StremioExtraSubtitleTrack[]) => boolean;
}

export function useStremioVideo(reportedMpvVersion: string | null): StremioVideoController {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<StremioVideo | null>(null);
  const transportRef = useRef<StremioShellTransport | null>(null);
  const loadGeneration = useRef(0);
  const subtitleGeneration = useRef(0);
  const extraTracks = useRef<StremioExtraSubtitleTrack[]>([]);
  const selectedExtra = useRef<string | null>(null);
  const nativeSurfaceVisible = useRef(false);
  const [state, setState] = useState(INITIAL_STATE);

  useEffect(() => {
    const reportBounds = () => {
      const element = containerRef.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      void setNativeVideoBounds({
        x: Math.max(0, bounds.left),
        y: Math.max(0, bounds.top),
        width: Math.max(0, Math.min(bounds.right, window.innerWidth) - Math.max(bounds.left, 0)),
        height: Math.max(0, Math.min(bounds.bottom, window.innerHeight) - Math.max(bounds.top, 0)),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        visible: nativeSurfaceVisible.current
          && bounds.left >= 0
          && bounds.top >= 0
          && bounds.right <= window.innerWidth
          && bounds.bottom <= window.innerHeight,
      });
    };
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(reportBounds);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (containerRef.current) observer?.observe(containerRef.current);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    let disposed = false;
    const eventListeners: Array<() => void> = [];
    void onNativePlayerFullscreenChanged((fullscreen) => {
      setState((current) => ({ ...current, fullscreen }));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else eventListeners.push(unlisten);
    });
    void onNativePlayerRenderError((message) => {
      setState((current) => ({ ...current, error: message }));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else eventListeners.push(unlisten);
    });
    schedule();
    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      disposed = true;
      eventListeners.forEach((unlisten) => unlisten());
      nativeSurfaceVisible.current = false;
      void setNativeVideoBounds({ x: 0, y: 0, width: 0, height: 0, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, visible: false });
    };
  }, []);

  useEffect(() => {
    const video = new StremioVideo();
    const transport = new StremioShellTransport(reportedMpvVersion);
    videoRef.current = video;
    transportRef.current = transport;

    video.on('implementationChanged', (...args: unknown[]) => {
      const manifest = args[0] as { props?: unknown } | undefined;
      if (!Array.isArray(manifest?.props)) return;
      manifest.props.forEach((propName) => {
        if (typeof propName === 'string') video.dispatch({ type: 'observeProp', propName });
      });
    });
    const receiveProperty = (...args: unknown[]) => {
      const [name, value] = args;
      if (typeof name !== 'string') return;
      if (name === 'volume') {
        if (typeof value === 'number' && Number.isFinite(value)) {
          setState((current) => ({ ...current, volume: Math.max(0, Math.min(100, value)) }));
        }
        return;
      }
      if (name === 'muted') {
        if (typeof value === 'boolean') setState((current) => ({ ...current, muted: value }));
        return;
      }
      // External tracks are rendered by native mpv, not the HTML overlay.
      if (['extraSubtitlesTracks', 'selectedExtraSubtitlesTrackId', 'extraSubtitlesDelay'].includes(name)) return;
      if (name === 'selectedSubtitlesTrackId' && selectedExtra.current) return;
      if (name === 'subtitlesDelay' && selectedExtra.current) {
        setState((current) => ({ ...current, extraSubtitlesDelay: value as number }));
        return;
      }
      if (name === 'subtitlesTracks' && Array.isArray(value)) {
        setState((current) => ({ ...current, subtitlesTracks: value.filter((track) => track.label !== 'Locadora external') }));
        return;
      }
      setState((current) => ({ ...current, [name]: value }));
    };
    video.on('propChanged', receiveProperty);
    video.on('propValue', receiveProperty);
    video.on('ended', () => setState((current) => ({ ...current, ended: true })));
    video.on('error', (...args: unknown[]) => {
      setState((current) => ({ ...current, error: stremioVideoError(args[0]) }));
    });

    return () => {
      loadGeneration.current += 1;
      subtitleGeneration.current += 1;
      video.destroy();
      void transport.destroy();
      videoRef.current = null;
      transportRef.current = null;
    };
  }, [reportedMpvVersion]);

  const load = useCallback(async (stream: StremioPlayableStream) => {
    const generation = ++loadGeneration.current;
    subtitleGeneration.current += 1;
    selectedExtra.current = null;
    setState({ ...INITIAL_STATE, buffering: true, extraSubtitlesTracks: extraTracks.current });
    const video = videoRef.current;
    const transport = transportRef.current;
    const containerElement = containerRef.current;
    if (!video || !transport || !containerElement) throw new Error('Stremio video is not ready');
    const usesTorrent = 'infoHash' in stream;
    const serviceAvailable = await stremioServiceAvailable();
    if (generation !== loadGeneration.current) return;
    if (usesTorrent && !serviceAvailable) {
      throw new Error('The official Stremio streaming service is not available');
    }
    await transport.start();
    if (generation !== loadGeneration.current) return;
    nativeSurfaceVisible.current = true;
    window.dispatchEvent(new Event('resize'));
    setState((current) => ({ ...current, streamingServiceAvailable: serviceAvailable }));
    video.dispatch({
      type: 'command',
      commandName: 'load',
      commandArgs: {
        stream,
        platform: 'linux',
        time: 0,
        hardwareDecoding: true,
        gpuVideoProcessing: false,
        assSubtitlesStyling: true,
        streamingServerURL: serviceAvailable ? STREMIO_SERVICE_URL : null,
      },
    }, {
      containerElement,
      shellTransport: transport,
      mpvSeparateWindow: false,
    });
  }, []);

  const unload = useCallback(() => {
    loadGeneration.current += 1;
    subtitleGeneration.current += 1;
    selectedExtra.current = null;
    nativeSurfaceVisible.current = false;
    void setNativePlayerFullscreen(false);
    window.dispatchEvent(new Event('resize'));
    videoRef.current?.dispatch({ type: 'command', commandName: 'unload' });
    setState({ ...INITIAL_STATE });
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    videoRef.current?.dispatch({ type: 'setProp', propName: 'paused', propValue: paused });
  }, []);

  const seekRelative = useCallback((seconds: number) => {
    const current = state.time ?? 0;
    videoRef.current?.dispatch({
      type: 'setProp',
      propName: 'time',
      propValue: Math.max(0, current + seconds * 1000),
    });
  }, [state.time]);

  const seekTo = useCallback((milliseconds: number) => {
    if (!Number.isFinite(milliseconds)) return;
    videoRef.current?.dispatch({ type: 'setProp', propName: 'time', propValue: Math.max(0, milliseconds) });
  }, []);

  const setFullscreen = useCallback((fullscreen: boolean) => {
    void setNativePlayerFullscreen(fullscreen).catch(() => {
      setState((current) => ({ ...current, error: 'Could not change fullscreen mode' }));
    });
  }, []);

  const setVolume = useCallback((volume: number) => {
    if (!Number.isFinite(volume)) return;
    videoRef.current?.dispatch({ type: 'setProp', propName: 'volume', propValue: Math.max(0, Math.min(100, volume)) });
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    videoRef.current?.dispatch({ type: 'setProp', propName: 'muted', propValue: muted });
  }, []);

  const selectAudioTrack = useCallback((id: string) => {
    videoRef.current?.dispatch({ type: 'setProp', propName: 'selectedAudioTrackId', propValue: id });
  }, []);

  const selectSubtitleTrack = useCallback((id: string | null, extra: boolean) => {
    const generation = ++subtitleGeneration.current;
    const track = extra ? extraTracks.current.find((track) => track.id === id) : null;
    if (extra && !track) return;
    selectedExtra.current = extra ? id : null;
    setState((current) => ({ ...current, subtitleLoading: true, subtitleError: null,
      selectedExtraSubtitlesTrackId: null, selectedSubtitlesTrackId: null }));
    void selectNativeSubtitle(track?.url ?? null).then(() => {
      if (generation !== subtitleGeneration.current) return;
      if (!extra) videoRef.current?.dispatch({ type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: id });
      setState((current) => ({ ...current, subtitleLoading: false,
        selectedExtraSubtitlesTrackId: extra ? id : null, selectedSubtitlesTrackId: extra ? null : id,
        subtitlesDelay: 0, extraSubtitlesDelay: 0 }));
    }).catch(() => {
      if (generation !== subtitleGeneration.current) return;
      selectedExtra.current = null;
      setState((current) => ({ ...current, subtitleLoading: false, subtitleError: 'subtitle-unavailable' }));
    });
  }, []);

  const setSubtitleDelay = useCallback((milliseconds: number, extra = Boolean(state.selectedExtraSubtitlesTrackId)) => {
    if (!Number.isFinite(milliseconds)) return;
    const generation = subtitleGeneration.current;
    const bounded = Math.max(-600_000, Math.min(600_000, Math.round(milliseconds)));
    void setNativePlayerProperty('sub-delay', bounded / 1_000).then(() => {
      if (generation !== subtitleGeneration.current) return;
      setState((current) => ({ ...current, [extra ? 'extraSubtitlesDelay' : 'subtitlesDelay']: bounded }));
    }).catch(() => {
      if (generation === subtitleGeneration.current) setState((current) => ({ ...current, subtitleError: 'subtitle-delay-failed' }));
    });
  }, [state.selectedExtraSubtitlesTrackId]);

  const addExtraSubtitlesTracks = useCallback((tracks: StremioExtraSubtitleTrack[]) => {
    extraTracks.current = tracks;
    setState((current) => ({ ...current, extraSubtitlesTracks: tracks }));
    return true;
  }, []);

  return {
    containerRef,
    state,
    load,
    unload,
    setPaused,
    seekRelative,
    seekTo,
    setFullscreen,
    setVolume,
    setMuted,
    selectAudioTrack,
    selectSubtitleTrack,
    setSubtitleDelay,
    addExtraSubtitlesTracks,
  };
}
