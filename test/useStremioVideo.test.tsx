// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  ensure: vi.fn().mockResolvedValue(undefined),
  dispatch: vi.fn(), select: vi.fn().mockResolvedValue(undefined), property: vi.fn().mockResolvedValue(undefined),
  bounds: vi.fn().mockResolvedValue(undefined), fullscreen: vi.fn().mockResolvedValue(undefined),
  probe: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@stremio/stremio-video', () => ({ default: class {
  on(name: string, listener: (...args: unknown[]) => void) { mocks.listeners.set(name, listener); }
  dispatch = mocks.dispatch;
  destroy() {}
} }));
vi.mock('../src/platform/stremioShellTransport', () => ({ StremioShellTransport: class {
  async start() {} async destroy() {}
} }));
vi.mock('../src/platform/stremioService', () => ({ STREMIO_SERVICE_URL: 'http://127.0.0.1:11471/', ensureStreamingService: mocks.ensure }));
vi.mock('../src/platform/nativeBridge', () => ({
  selectNativeSubtitle: mocks.select,
  setNativePlayerProperty: mocks.property,
  setNativeVideoBounds: mocks.bounds,
  setNativePlayerFullscreen: mocks.fullscreen,
  reportSurfaceProbe: mocks.probe,
  onNativePlayerFullscreenChanged: async () => () => undefined,
  onNativePlayerRenderError: async () => () => undefined,
}));
import { useStremioVideo } from '../src/media/useStremioVideo';

const track = { id: 'ADDON_test', url: 'https://subtitles.example.invalid/test.srt', lang: 'pt-BR', label: 'Português', origin: 'Test', embedded: false as const };
beforeEach(() => { vi.clearAllMocks(); mocks.listeners.clear(); });
afterEach(cleanup);

describe('native subtitle coordination', () => {
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
      commandName: 'load', commandArgs: expect.objectContaining({ streamingServerURL: 'http://127.0.0.1:11471/' }),
    }), expect.anything());
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
    viewport.getBoundingClientRect = () => ({ left: 10, top: 60, right: 810, bottom: 510, width: 800, height: 450, x: 10, y: 60, toJSON() {} });
    Object.defineProperty(result.current.containerRef, 'current', { configurable: true, value: host });
    Object.defineProperty(result.current.viewportRef, 'current', { configurable: true, value: viewport });
    await act(async () => { await result.current.load({ url: 'https://media.example.invalid/video' }); });
    await waitFor(() => expect(mocks.bounds).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 60, width: 800, height: 450, visible: true })));
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
});
