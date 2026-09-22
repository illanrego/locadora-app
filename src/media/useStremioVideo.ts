import StremioVideo from '@stremio/stremio-video';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { safeDiagnostic } from './redaction';
import { StremioShellTransport } from '../platform/stremioShellTransport';
import { STREMIO_SERVICE_URL, stremioServiceAvailable } from '../platform/stremioService';
import type { StremioPlayableStream } from './stremioStream';

export interface StremioVideoState {
  loaded: boolean;
  paused: boolean;
  buffering: boolean;
  time: number | null;
  duration: number | null;
  audioTracks: unknown[];
  subtitlesTracks: unknown[];
  error: string | null;
  ended: boolean;
}

const INITIAL_STATE: StremioVideoState = {
  loaded: false,
  paused: false,
  buffering: false,
  time: null,
  duration: null,
  audioTracks: [],
  subtitlesTracks: [],
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
}

export function useStremioVideo(reportedMpvVersion: string | null): StremioVideoController {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<StremioVideo | null>(null);
  const transportRef = useRef<StremioShellTransport | null>(null);
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
    if (usesTorrent && !await stremioServiceAvailable()) {
      throw new Error('The official Stremio streaming service is not available');
    }
    await transport.start();
    setState(INITIAL_STATE);
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
        streamingServerURL: usesTorrent ? STREMIO_SERVICE_URL : null,
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

  return { containerRef, state, load, unload, setPaused, seekRelative };
}
