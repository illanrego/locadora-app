// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  ensure: vi.fn().mockResolvedValue(undefined),
  dispatch: vi.fn(), select: vi.fn().mockResolvedValue(undefined), property: vi.fn().mockResolvedValue(undefined),
  bounds: vi.fn().mockResolvedValue(undefined), fullscreen: vi.fn().mockResolvedValue(undefined),
  probe: vi.fn().mockResolvedValue(undefined), torrent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@stremio/stremio-video', () => ({ default: class {
  on(name: string, listener: (...args: unknown[]) => void) { mocks.listeners.set(name, listener); }
  dispatch = mocks.dispatch;
  destroy() {}
} }));
vi.mock('../src/platform/stremioShellTransport', () => ({ StremioShellTransport: class {
  async start() {} async destroy() {}
} }));
vi.mock('../src/platform/stremioService', () => ({ STREMIO_SERVICE_URL: 'http://127.0.0.1:11471/', ensureStreamingService: mocks.ensure, ensureTorrentStream: mocks.torrent }));
vi.mock('../src/platform/nativeBridge', () => ({
  selectNativeSubtitle: mocks.select,
  setNativePlayerProperty: mocks.property,
  setNativeVideoBounds: mocks.bounds,
  setNativePlayerFullscreen: mocks.fullscreen,
  reportSurfaceProbe: mocks.probe,
  onNativePlayerFullscreenChanged: async (listener: (fullscreen: boolean) => void) => {
    mocks.listeners.set('native-fullscreen', listener as (...args: unknown[]) => void);
    return () => mocks.listeners.delete('native-fullscreen');
  },
  onNativePlayerRenderError: async () => () => undefined,
}));
import { useStremioVideo } from '../src/media/useStremioVideo';

const track = { id: 'ADDON_test', url: 'https://subtitles.example.invalid/test.srt', lang: 'pt-BR', label: 'Português', origin: 'Test', embedded: false as const };
beforeEach(() => { vi.clearAllMocks(); mocks.listeners.clear(); });
afterEach(cleanup);

describe('native subtitle coordination', () => {
  it('preserves native fullscreen across source changes, failures and retry until the window exits', async () => {
    const { result } = renderHook(() => useStremioVideo('0.35.1'));
    Object.defineProperty(result.current.containerRef, 'current', { configurable: true, value: document.createElement('div') });
    act(() => mocks.listeners.get('native-fullscreen')?.(true));
    await act(async () => { await result.current.load({ url: 'https://media.example.invalid/first' }); });
    expect(result.current.state.fullscreen).toBe(true);
    mocks.ensure.mockRejectedValueOnce(new Error('Streaming port is busy'));
    await act(async () => {
      await expect(result.current.load({ infoHash: 'a'.repeat(40), fileIdx: 0, announce: [] })).rejects.toThrow('busy');
    });
    expect(result.current.state.fullscreen).toBe(true);
    await act(async () => { await result.current.load({ url: 'https://media.example.invalid/retry' }); });
    expect(result.current.state.fullscreen).toBe(true);
    expect(mocks.fullscreen).not.toHaveBeenCalled();
    act(() => mocks.listeners.get('native-fullscreen')?.(false));
    expect(result.current.state.fullscreen).toBe(false);
  });

  it('starts the bundled engine before loading torrents and surfaces startup failure', async () => {
    const { result } = renderHook(() => useStremioVideo('0.35.1'));
    Object.defineProperty(result.current.containerRef, 'current', { configurable: true, value: document.createElement('div') });
    const stream = { infoHash: 'a'.repeat(40), fileIdx: 0, announce: [] };
    mocks.ensure.mockRejectedValueOnce(new Error('Streaming port is busy'));
    await act(async () => { await expect(result.current.load(stream)).rejects.toThrow('busy'); });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ commandName: 'load' }), expect.anything());
    await act(async () => { await result.current.load(stream); });
    expect(mocks.ensure).toHaveBeenCalledTimes(2);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      commandName: 'load', commandArgs: expect.objectContaining({
        streamingServerURL: 'http://127.0.0.1:11471/',
        formats: expect.arrayContaining(['mp4', 'matroska,webm', 'mpegts']),
        videoCodecs: expect.arrayContaining(['h264', 'hevc', 'av1']),
        audioCodecs: expect.arrayContaining(['aac', 'ac3', 'dts', 'flac', 'truehd']),
        maxAudioChannels: 8,
      }),
    }), expect.anything());
    const load = mocks.dispatch.mock.calls.find(([action]) => action.commandName === 'load')?.[0];
    expect(load.commandArgs.formats.length).toBeGreaterThan(0);
    expect(load.commandArgs.videoCodecs.length).toBeGreaterThan(0);
    expect(load.commandArgs.audioCodecs.length).toBeGreaterThan(0);
  });

  it('does not start playback when closed during engine startup', async () => {
    let finish!: () => void;
    mocks.ensure.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useStremioVideo('0.35.1'));
    Object.defineProperty(result.current.containerRef, 'current', { configurable: true, value: document.createElement('div') });
    await act(async () => {
      const loading = result.current.load({ infoHash: 'b'.repeat(40), fileIdx: 0, announce: [] });
      result.current.unload();
      finish();
      await loading;
    });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ commandName: 'load' }), expect.anything());
  });

  it('uses official volume/mute properties and clamps invalid volume input', () => {
    const { result } = renderHook(() => useStremioVideo('0.35.1'));
    act(() => { result.current.setVolume(500); result.current.setMuted(true); result.current.setVolume(NaN); });
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'setProp', propName: 'volume', propValue: 100 });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'setProp', propName: 'muted', propValue: true });
    act(() => { mocks.listeners.get('propChanged')?.('volume', 45); mocks.listeners.get('propChanged')?.('muted', true); });
    expect(result.current.state.volume).toBe(45);
    expect(result.current.state.muted).toBe(true);
  });

  it('loads the official shell into the embedded surface and controls native fullscreen', async () => {
    const { result } = renderHook(() => useStremioVideo('0.35.1'));
    Object.defineProperty(result.current.containerRef, 'current', { configurable: true, value: document.createElement('div') });
    await act(async () => { await result.current.load({ url: 'https://media.example.invalid/video' }); });
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command', commandName: 'load' }),
      expect.objectContaining({ mpvSeparateWindow: false }),
    );
    act(() => { result.current.setFullscreen(true); });
    await waitFor(() => expect(mocks.fullscreen).toHaveBeenCalledWith(true));
  });

  it('measures the stable outer frame even when the upstream subtitle host collapses', async () => {
    const { result } = renderHook(() => useStremioVideo('0.35.1'));
    const host = document.createElement('div');
    host.style.position = 'relative';
    const viewport = document.createElement('div');
    let rectangle = { left: 10, top: 60, right: 810, bottom: 510, width: 800, height: 450, x: 10, y: 60, toJSON() {} };
    viewport.getBoundingClientRect = () => rectangle;
    Object.defineProperty(result.current.containerRef, 'current', { configurable: true, value: host });
    Object.defineProperty(result.current.viewportRef, 'current', { configurable: true, value: viewport });
    await act(async () => { await result.current.load({ url: 'https://media.example.invalid/video' }); });
    await waitFor(() => expect(mocks.bounds).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 60, width: 800, height: 450, visible: true })));
    rectangle = { left: 0, top: 0, right: 1024, bottom: 720, width: 1024, height: 720, x: 0, y: 0, toJSON() {} };
    act(() => result.current.refreshBounds());
    await waitFor(() => expect(mocks.bounds).toHaveBeenCalledWith(expect.objectContaining({ x: 0, y: 0, width: 1024, height: 720, visible: true })));
    act(() => result.current.unload());
    await waitFor(() => expect(mocks.bounds).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false })));
  });

  it('loads external subtitles into mpv without requiring Stremio Service or an HTML overlay', async () => {
    const { result } = renderHook(() => useStremioVideo('0.35.1'));
    act(() => { result.current.addExtraSubtitlesTracks([track]); });
    act(() => { result.current.selectSubtitleTrack(track.id, true); });
    await waitFor(() => expect(result.current.state.selectedExtraSubtitlesTrackId).toBe(track.id));
    expect(mocks.select).toHaveBeenCalledWith(track.url);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ propName: 'selectedExtraSubtitlesTrackId' }));
    act(() => { result.current.setSubtitleDelay(-1500, true); });
    await waitFor(() => expect(result.current.state.extraSubtitlesDelay).toBe(-1500));
    expect(mocks.property).toHaveBeenCalledWith('sub-delay', -1.5);
  });

  it('keeps embedded delay in milliseconds and turns subtitles off through the native boundary', async () => {
    const { result } = renderHook(() => useStremioVideo('0.35.1'));
    act(() => { result.current.selectSubtitleTrack('EMBEDDED_2', false); });
    await waitFor(() => expect(result.current.state.selectedSubtitlesTrackId).toBe('EMBEDDED_2'));
    act(() => { mocks.listeners.get('propChanged')?.('subtitlesDelay', 1250); });
    expect(result.current.state.subtitlesDelay).toBe(1250);
    act(() => { result.current.selectSubtitleTrack(null, false); });
    await waitFor(() => expect(result.current.state.subtitleLoading).toBe(false));
    expect(mocks.select).toHaveBeenLastCalledWith(null);
    expect(mocks.dispatch).toHaveBeenLastCalledWith({ type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: null });
  });

  it('reports subtitle failure without ending playback', async () => {
    mocks.select.mockRejectedValueOnce(new Error('download unavailable'));
    const { result } = renderHook(() => useStremioVideo('0.35.1'));
    act(() => { result.current.addExtraSubtitlesTracks([track]); result.current.selectSubtitleTrack(track.id, true); });
    await waitFor(() => expect(result.current.state.subtitleError).toBe('subtitle-unavailable'));
    expect(result.current.state.error).toBeNull();
  });

  it('registers a torrent with the engine before loading it, and not for a url stream', async () => {
    const { result } = renderHook(() => useStremioVideo('0.35.1'));
    Object.defineProperty(result.current.containerRef, 'current', { configurable: true, value: document.createElement('div') });
    const stream = { infoHash: 'C'.repeat(40), fileIdx: 3, announce: ['udp://tracker.example.invalid:1337'] };
    await act(async () => { await result.current.load(stream); });
    expect(mocks.torrent).toHaveBeenCalledWith(stream);
    mocks.torrent.mockClear();
    await act(async () => { await result.current.load({ url: 'https://media.example.invalid/video' }); });
    expect(mocks.torrent).not.toHaveBeenCalled();
  });

  it('retries through the engine route when a load never starts, and leaves a started load alone', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useStremioVideo('0.35.1'));
      Object.defineProperty(result.current.containerRef, 'current', { configurable: true, value: document.createElement('div') });
      await act(async () => { await result.current.load({ infoHash: 'd'.repeat(40), fileIdx: 0, announce: [] }); });
      const loads = () => mocks.dispatch.mock.calls.filter(([action]) => action.commandName === 'load').map(([action]) => action);
      expect(loads()).toHaveLength(1);
      expect(loads()[0].commandArgs.formats.length).toBeGreaterThan(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(26_000); });
      expect(loads()).toHaveLength(2);
      expect(loads()[1].commandArgs.formats).toHaveLength(0);
      mocks.dispatch.mockClear();
      await act(async () => { await result.current.load({ infoHash: 'e'.repeat(40), fileIdx: 0, announce: [] }); });
      act(() => { mocks.listeners.get('propChanged')?.('loaded', true); });
      await act(async () => { await vi.advanceTimersByTimeAsync(26_000); });
      expect(loads()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
