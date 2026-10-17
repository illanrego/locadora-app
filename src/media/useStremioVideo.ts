import StremioVideo from '@stremio/stremio-video';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { safeDiagnostic } from './redaction';
import { visibleVideoBounds } from './videoBounds';
import { StremioShellTransport } from '../platform/stremioShellTransport';
import { STREMIO_SERVICE_URL, ensureStreamingService, ensureTorrentStream } from '../platform/stremioService';
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

// The shell plays through native libmpv, not WebKit's HTML media element.
// Override Stremio Video's browser sniffing when its engine probes a stream.
const NATIVE_MEDIA_CAPABILITIES = {
  formats: ['mp4', 'matroska,webm', 'mpegts'],
  videoCodecs: ['h264', 'h265', 'hevc', 'vp8', 'vp9', 'av1'],
  audioCodecs: ['aac', 'mp3', 'ac3', 'eac3', 'vorbis', 'opus', 'dts', 'flac', 'truehd'],
  maxAudioChannels: 8,
};

// Empty capability lists make Stremio Video's probe reject the stream, so it
// falls back to its engine route, which serves any torrent. Used only as a
// second attempt when a direct media URL never starts playing.
const FALLBACK_ROUTE_CAPABILITIES = {
  formats: [] as string[],
  videoCodecs: [] as string[],
  audioCodecs: [] as string[],
  maxAudioChannels: 0,
};

// A direct URL the engine cannot serve leaves mpv waiting silently, so a load
// that has produced no picture by now is retried through the engine route.
const LOAD_STALL_TIMEOUT_MS = 25_000;

function stremioVideoError(value: unknown): string {
  if (value && typeof value === 'object' && 'error' in value) {
    return safeDiagnostic((value as { error: unknown }).error);
  }
  return safeDiagnostic(value);
}

export interface StremioVideoController {
  viewportRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  state: StremioVideoState;
  load: (stream: StremioPlayableStream) => Promise<void>;
  unload: () => void;
  setPaused: (paused: boolean) => void;
  seekRelative: (seconds: number) => void;
  seekTo: (milliseconds: number) => void;
  setFullscreen: (fullscreen: boolean) => void;
  refreshBounds: () => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  selectAudioTrack: (id: string) => void;
  selectSubtitleTrack: (id: string | null, extra: boolean) => void;
  setSubtitleDelay: (milliseconds: number, extra?: boolean) => void;
  addExtraSubtitlesTracks: (tracks: StremioExtraSubtitleTrack[]) => boolean;
}

export function useStremioVideo(reportedMpvVersion: string | null): StremioVideoController {
  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<StremioVideo | null>(null);
  const transportRef = useRef<StremioShellTransport | null>(null);
  const loadGeneration = useRef(0);
  const subtitleGeneration = useRef(0);
  const extraTracks = useRef<StremioExtraSubtitleTrack[]>([]);
  const selectedExtra = useRef<string | null>(null);
  const nativeSurfaceVisible = useRef(false);
  const loadedRef = useRef(false);
  const loadStallTimer = useRef<number | null>(null);
  const presentationTimers = useRef<number[]>([]);
  // The surface is re-measured shortly after a load because the cinema layout
  // settles asynchronously; a single report can land mid-layout.
  const scheduleBounds = useRef<() => void>(() => {});
  const [state, setState] = useState(INITIAL_STATE);

  useEffect(() => {
    let lastGood: ReturnType<typeof visibleVideoBounds> | null = null;
    let retries = 0;
    const reportBounds = () => {
      const element = viewportRef.current ?? containerRef.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const fullscreen = Boolean(element.closest('.player-is-fullscreen'));
      const next = visibleVideoBounds(bounds, window.innerWidth, window.innerHeight, nativeSurfaceVisible.current, fullscreen);
      if (lastGood?.fullscreen !== fullscreen) lastGood = null;
      if (next.width >= 1 && next.height >= 1) {
        lastGood = next;
        retries = 0;
      } else if (nativeSurfaceVisible.current) {
        // A layout pass can measure the surface as zero-sized for a frame (for
        // example while the dialog re-lays out before the player settles).
        // Reporting that hides the native surface until some unrelated resize
        // happens, so retry briefly and keep the last real rectangle.
        if (lastGood) void setNativeVideoBounds({ ...lastGood, visible: true });
        if (retries < 90) {
          retries += 1;
          schedule();
        }
        return;
      }
      void setNativeVideoBounds(next);
    };
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(reportBounds);
    };
    scheduleBounds.current = schedule;
    const onResize = () => schedule();
    const onScroll = () => schedule();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (viewportRef.current ?? containerRef.current) observer?.observe((viewportRef.current ?? containerRef.current)!);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
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
      presentationTimers.current.forEach((timer) => window.clearTimeout(timer));
      presentationTimers.current = [];
      scheduleBounds.current = () => {};
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      disposed = true;
      eventListeners.forEach((unlisten) => unlisten());
      nativeSurfaceVisible.current = false;
      void setNativeVideoBounds({ x: 0, y: 0, width: 0, height: 0, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, visible: false, fullscreen: false });
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
      if (name === 'loaded') loadedRef.current = value === true;
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
      if (loadStallTimer.current !== null) {
        window.clearTimeout(loadStallTimer.current);
        loadStallTimer.current = null;
      }
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
    // Fullscreen belongs to the native window, not the source being loaded.
    setState((current) => ({ ...INITIAL_STATE, fullscreen: current.fullscreen,
      buffering: true, extraSubtitlesTracks: extraTracks.current }));
    const video = videoRef.current;
    const transport = transportRef.current;
    const containerElement = containerRef.current;
    if (!video || !transport || !containerElement) throw new Error('Stremio video is not ready');
    const usesTorrent = 'infoHash' in stream;
    loadedRef.current = false;
    if (loadStallTimer.current !== null) {
      window.clearTimeout(loadStallTimer.current);
      loadStallTimer.current = null;
    }
    video.dispatch({ type: 'command', commandName: 'unload' });
    nativeSurfaceVisible.current = false;
    window.dispatchEvent(new Event('resize'));
    if (usesTorrent) {
      await ensureStreamingService();
      // Best effort: without the torrent registered in the engine, the direct
      // media URL is not servable and the load below would never start.
      await ensureTorrentStream(stream).catch(() => undefined);
    }
    const serviceAvailable = usesTorrent;
    if (generation !== loadGeneration.current) return;
    await transport.start();
    if (generation !== loadGeneration.current) return;
    nativeSurfaceVisible.current = true;
    window.dispatchEvent(new Event('resize'));
    // Re-measure while the cinema layout settles; a single report can land
    // mid-layout and would otherwise leave the native surface hidden.
    for (const delay of [150, 400, 900, 2000]) {
      window.setTimeout(() => scheduleBounds.current(), delay);
    }
    setState((current) => ({ ...current, streamingServiceAvailable: serviceAvailable }));
    const dispatchLoad = (capabilities: typeof NATIVE_MEDIA_CAPABILITIES) => {
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
          ...capabilities,
          // Exempts this shell's loads from the library's HTML-video subtitle
          // and audio-track limits (applied by tools/patch-native-video-playability.mjs).
          nativePlayer: true,
        },
      }, {
        containerElement,
        shellTransport: transport,
        mpvSeparateWindow: false,
      });
    };
    dispatchLoad(NATIVE_MEDIA_CAPABILITIES);
    // One fallback attempt per load: a stalled direct URL must not strand the
    // player on its loading screen.
    loadStallTimer.current = window.setTimeout(() => {
      loadStallTimer.current = null;
      if (generation !== loadGeneration.current || loadedRef.current) return;
      dispatchLoad(FALLBACK_ROUTE_CAPABILITIES);
    }, LOAD_STALL_TIMEOUT_MS);
  }, []);

  const unload = useCallback(() => {
    loadGeneration.current += 1;
    subtitleGeneration.current += 1;
    selectedExtra.current = null;
    nativeSurfaceVisible.current = false;
    loadedRef.current = false;
    if (loadStallTimer.current !== null) {
      window.clearTimeout(loadStallTimer.current);
      loadStallTimer.current = null;
    }
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

  const refreshBounds = useCallback(() => {
    presentationTimers.current.forEach((timer) => window.clearTimeout(timer));
    scheduleBounds.current();
    presentationTimers.current = [60, 180, 420].map((delay) => window.setTimeout(
      () => scheduleBounds.current(),
      delay,
    ));
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
    viewportRef,
    containerRef,
    state,
    load,
    unload,
    setPaused,
    seekRelative,
    seekTo,
    setFullscreen,
    refreshBounds,
    setVolume,
    setMuted,
    selectAudioTrack,
    selectSubtitleTrack,
    setSubtitleDelay,
    addExtraSubtitlesTracks,
  };
}
