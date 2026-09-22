import StremioVideo from '@stremio/stremio-video';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { safeDiagnostic } from './redaction';
import { StremioShellTransport } from '../platform/stremioShellTransport';
import { STREMIO_SERVICE_URL, stremioServiceAvailable } from '../platform/stremioService';
import type { StremioPlayableStream } from './stremioStream';
import type { StremioExtraSubtitleTrack } from './subtitleResolution';

export interface StremioVideoState {
  loaded: boolean;
  paused: boolean;
  buffering: boolean;
  time: number | null;
  duration: number | null;
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
  selectAudioTrack: (id: string) => void;
  selectSubtitleTrack: (id: string | null, extra: boolean) => void;
  setSubtitleDelay: (milliseconds: number, extra?: boolean) => void;
  addExtraSubtitlesTracks: (tracks: StremioExtraSubtitleTrack[]) => boolean;
}

export function useStremioVideo(reportedMpvVersion: string | null): StremioVideoController {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<StremioVideo | null>(null);
  const transportRef = useRef<StremioShellTransport | null>(null);
  const streamingServiceRef = useRef(false);
  const [state, setState] = useState(INITIAL_STATE);

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
    video.on('propChanged', (...args: unknown[]) => {
      const [name, value] = args;
      if (typeof name !== 'string') return;
      setState((current) => ({ ...current, [name]: value }));
    });
    video.on('propValue', (...args: unknown[]) => {
      const [name, value] = args;
      if (typeof name !== 'string') return;
      setState((current) => ({ ...current, [name]: value }));
    });
    video.on('ended', () => setState((current) => ({ ...current, ended: true })));
    video.on('error', (...args: unknown[]) => {
      setState((current) => ({ ...current, error: stremioVideoError(args[0]) }));
    });

    return () => {
      video.destroy();
      void transport.destroy();
      videoRef.current = null;
      transportRef.current = null;
    };
  }, [reportedMpvVersion]);

  const load = useCallback(async (stream: StremioPlayableStream) => {
    const video = videoRef.current;
    const transport = transportRef.current;
    const containerElement = containerRef.current;
    if (!video || !transport || !containerElement) throw new Error('Stremio video is not ready');
    const usesTorrent = 'infoHash' in stream;
    const serviceAvailable = await stremioServiceAvailable();
    streamingServiceRef.current = serviceAvailable;
    if (usesTorrent && !serviceAvailable) {
      throw new Error('The official Stremio streaming service is not available');
    }
    await transport.start();
    setState({ ...INITIAL_STATE, streamingServiceAvailable: serviceAvailable });
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
      mpvSeparateWindow: true,
    });
  }, []);

  const unload = useCallback(() => {
    videoRef.current?.dispatch({ type: 'command', commandName: 'unload' });
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

  const selectAudioTrack = useCallback((id: string) => {
    videoRef.current?.dispatch({ type: 'setProp', propName: 'selectedAudioTrackId', propValue: id });
  }, []);

  const selectSubtitleTrack = useCallback((id: string | null, extra: boolean) => {
    videoRef.current?.dispatch({
      type: 'setProp',
      propName: 'selectedSubtitlesTrackId',
      propValue: extra ? null : id,
    });
    videoRef.current?.dispatch({
      type: 'setProp',
      propName: 'selectedExtraSubtitlesTrackId',
      propValue: extra ? id : null,
    });
  }, []);

  const setSubtitleDelay = useCallback((milliseconds: number, extra = Boolean(state.selectedExtraSubtitlesTrackId)) => {
    if (!Number.isFinite(milliseconds)) return;
    const bounded = Math.max(-600_000, Math.min(600_000, Math.round(milliseconds)));
    videoRef.current?.dispatch(extra ? {
      type: 'setProp',
      propName: 'extraSubtitlesDelay',
      propValue: bounded,
    } : {
      type: 'setProp',
      propName: 'subtitlesDelay',
      propValue: bounded / 1_000,
    });
  }, [state.selectedExtraSubtitlesTrackId]);

  const addExtraSubtitlesTracks = useCallback((tracks: StremioExtraSubtitleTrack[]) => {
    if (!streamingServiceRef.current || !tracks.length) return false;
    videoRef.current?.dispatch({
      type: 'command',
      commandName: 'addExtraSubtitlesTracks',
      commandArgs: { tracks },
    });
    return true;
  }, []);

  return {
    containerRef,
    state,
    load,
    unload,
    setPaused,
    seekRelative,
    selectAudioTrack,
    selectSubtitleTrack,
    setSubtitleDelay,
    addExtraSubtitlesTracks,
  };
}
