// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

const native = vi.hoisted(() => ({
  control: vi.fn().mockResolvedValue(undefined),
  load: vi.fn().mockResolvedValue(undefined),
  events: vi.fn().mockResolvedValue([]),
  setProperty: vi.fn().mockResolvedValue(undefined),
  shutdown: vi.fn().mockResolvedValue(undefined),
  start: vi.fn().mockResolvedValue(undefined),
}));
const tapeWindow = vi.hoisted(() => ({
  closed: vi.fn(),
  ended: vi.fn(),
  errored: vi.fn(),
  started: vi.fn(),
}));

vi.mock('../src/platform/nativeBridge', () => ({
  controlNativePlayer: native.control,
  loadNativePlayer: native.load,
  readNativePlayerEvents: native.events,
  setNativePlayerProperty: native.setProperty,
  shutdownNativePlayer: native.shutdown,
  startNativePlayer: native.start,
}));
vi.mock('../src/rentals/tapePlaybackWindow', () => ({
  notifyTapePlaybackClosed: tapeWindow.closed,
  notifyTapePlaybackEnded: tapeWindow.ended,
  notifyTapePlaybackErrored: tapeWindow.errored,
  notifyTapePlaybackStarted: tapeWindow.started,
}));

import { StremioShellTransport } from '../src/platform/stremioShellTransport';

beforeEach(() => {
  Object.values(native).forEach((mock) => mock.mockClear());
  Object.values(tapeWindow).forEach((mock) => mock.mockClear());
});

describe('official Stremio video shell adapter', () => {
  it('reports the native mpv version and maps only allowlisted properties', async () => {
    const transport = new StremioShellTransport('mpv 0.35.1 Copyright');
    const property = vi.fn();
    transport.on('mpv-prop-change', property);
    await transport.start();
    transport.send('mpv-observe-prop', 'mpv-version');
    transport.send('mpv-set-prop', ['pause', true]);
    transport.send('mpv-set-prop', ['vo', 'libmpv']);

    await waitFor(() => expect(property).toHaveBeenCalledWith({ name: 'mpv-version', data: '0.35.1' }));
    await waitFor(() => expect(native.setProperty).toHaveBeenCalledTimes(1));
    expect(native.setProperty).toHaveBeenCalledWith('pause', true);
    await transport.destroy();
    expect(native.shutdown).toHaveBeenCalledOnce();
  });

  it('loads media through the native boundary without putting it in process arguments', async () => {
    const transport = new StremioShellTransport('0.35.1');
    const ready = vi.fn();
    transport.on('mpv-event-video-ready', ready);
    await transport.start();
    transport.send('mpv-command', ['loadfile', 'https://media.example.invalid/video']);

    await waitFor(() => expect(native.load).toHaveBeenCalledOnce());
    expect(tapeWindow.started).toHaveBeenCalledOnce();
    expect(tapeWindow.started).toHaveBeenCalledWith('https://media.example.invalid/video');
    expect(ready).toHaveBeenCalledWith({ loadId: 1, ready: false });
    await transport.destroy();
  });

  it('forwards only the native boundary\'s sanitized mpv properties', async () => {
    native.events.mockResolvedValueOnce([
      { kind: 'property', value: { name: 'track-list', data: [{ type: 'audio', id: 1 }] } },
      { kind: 'property', value: { name: 'paused-for-cache', data: true } },
    ]);
    const transport = new StremioShellTransport('0.35.1');
    const property = vi.fn();
    transport.on('mpv-prop-change', property);
    await transport.start();

    await waitFor(() => expect(property).toHaveBeenCalledTimes(2));
    expect(property).toHaveBeenCalledWith({ name: 'track-list', data: [{ type: 'audio', id: 1 }] });
    expect(property).toHaveBeenCalledWith({ name: 'paused-for-cache', data: true });
    await transport.destroy();
  });

  it('requests the embedded copy-back-capable decode policy', async () => {
    const transport = new StremioShellTransport('0.35.1');
    await transport.start();
    transport.send('mpv-set-prop', ['hwdec', 'auto-copy']);

    await waitFor(() => expect(native.setProperty).toHaveBeenCalledOnce());
    expect(native.setProperty).toHaveBeenCalledWith('hwdec', 'auto-copy-safe');
    await transport.destroy();
  });

  it('does not clear a cache stall when pause or seek state changes', async () => {
    native.events.mockResolvedValueOnce([
      { kind: 'property', value: { name: 'paused-for-cache', data: true } },
      { kind: 'playing' },
      { kind: 'property', value: { name: 'seeking', data: false } },
    ]);
    const transport = new StremioShellTransport('0.35.1');
    const property = vi.fn();
    transport.on('mpv-prop-change', property);
    await transport.start();
    await waitFor(() => expect(property).toHaveBeenCalledTimes(3));
    expect(property).not.toHaveBeenCalledWith({ name: 'paused-for-cache', data: false });
    await transport.destroy();
  });

  it('reports the native reason for a rejected load and ignores rejected properties', async () => {
    const transport = new StremioShellTransport('0.35.1');
    const ended = vi.fn();
    transport.on('mpv-event-ended', ended);
    await transport.start();

    native.setProperty.mockRejectedValueOnce('The player command failed');
    native.load.mockRejectedValueOnce('The playback descriptor is not allowed');
    transport.send('mpv-set-prop', ['volume', 50]);
    transport.send('mpv-command', ['loadfile', 'https://media.example.invalid/video']);

    await waitFor(() => expect(ended).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith({ error: 'The playback descriptor is not allowed' });
    expect(tapeWindow.errored).toHaveBeenCalledOnce();
    await transport.destroy();
  });

  it('reports native end and failure events to the tape window', async () => {
    native.events.mockResolvedValueOnce([
      { kind: 'ended', value: 'eof' },
      { kind: 'failed', value: 'Synthetic failure' },
    ]);
    const transport = new StremioShellTransport('0.35.1');
    await transport.start();
    await waitFor(() => expect(tapeWindow.ended).toHaveBeenCalledOnce());
    expect(tapeWindow.errored).toHaveBeenCalledOnce();
    await transport.destroy();
    expect(tapeWindow.closed).toHaveBeenCalledOnce();
  });
});
