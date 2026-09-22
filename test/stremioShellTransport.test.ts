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

vi.mock('../src/platform/nativeBridge', () => ({
  controlNativePlayer: native.control,
  loadNativePlayer: native.load,
  readNativePlayerEvents: native.events,
  setNativePlayerProperty: native.setProperty,
  shutdownNativePlayer: native.shutdown,
  startNativePlayer: native.start,
}));

import { StremioShellTransport } from '../src/platform/stremioShellTransport';

beforeEach(() => {
  Object.values(native).forEach((mock) => mock.mockClear());
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
    await transport.destroy();
  });
});
