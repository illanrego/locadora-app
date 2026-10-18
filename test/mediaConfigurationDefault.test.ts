// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const bundled = { id: 'public-meta', name: 'Public metadata', resources: ['meta'], supportsStreams: false, supportsSubtitles: false };
const privateAddon = { id: 'user-stream', name: 'User stream', resources: ['stream'], supportsStreams: true, supportsSubtitles: false };
const subtitlesOnly = { id: 'user-subs', name: 'User subtitles', resources: ['subtitles'], supportsStreams: false, supportsSubtitles: true };

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  window.localStorage.clear();
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});

describe('default media configuration', () => {
  it('seeds the public metadata manifest once on the first empty profile read', async () => {
    let addons: typeof bundled[] = [];
    invoke.mockImplementation(async (command: string, args?: { manifestUrl?: string }) => {
      if (command === 'media_configuration_status') return addons;
      if (command === 'media_configuration_add') {
        expect(args?.manifestUrl).toBe('https://v3-cinemeta.strem.io/manifest.json');
        addons = [bundled];
        return addons;
      }
      throw new Error('Unexpected command');
    });
    const { readMediaConfiguration } = await import('../src/platform/nativeBridge');
    expect(await readMediaConfiguration()).toEqual([bundled]);
    expect(await readMediaConfiguration()).toEqual([bundled]);
    expect(invoke.mock.calls.filter(([name]) => name === 'media_configuration_add')).toHaveLength(1);
  });

  it('preserves an existing configuration and its order', async () => {
    invoke.mockResolvedValue([privateAddon, bundled]);
    const { readMediaConfiguration } = await import('../src/platform/nativeBridge');
    expect(await readMediaConfiguration()).toEqual([privateAddon, bundled]);
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['media_configuration_status']);
  });

  it('appends the metadata default after a configuration that cannot answer meta, without reordering it', async () => {
    let addons = [privateAddon, subtitlesOnly];
    invoke.mockImplementation(async (command: string) => {
      if (command === 'media_configuration_status') return addons;
      if (command === 'media_configuration_add') {
        addons = [...addons, bundled];
        return addons;
      }
      throw new Error('Unexpected command');
    });
    const { readMediaConfiguration } = await import('../src/platform/nativeBridge');

    expect(await readMediaConfiguration()).toEqual([privateAddon, subtitlesOnly, bundled]);
    // The user's own add-ons keep their order, and the default is added once.
    expect(await readMediaConfiguration()).toEqual([privateAddon, subtitlesOnly, bundled]);
    expect(invoke.mock.calls.filter(([name]) => name === 'media_configuration_add')).toHaveLength(1);
  });

  it('keeps explicit disconnect empty and preserves the read-only import path', async () => {
    let addons = [bundled];
    invoke.mockImplementation(async (command: string) => {
      if (command === 'media_configuration_import_stremio') {
        addons = [privateAddon];
        return { addons, imported: 1, skipped: [], source: 'installed Stremio' };
      }
      if (command === 'media_configuration_add') {
        addons = [...addons, bundled];
        return addons;
      }
      if (command === 'media_configuration_disconnect') {
        addons = [];
        return undefined;
      }
      if (command === 'media_configuration_status') return addons;
      throw new Error('Unexpected command');
    });
    const { importInstalledStremioConfiguration, disconnectMediaConfiguration, readMediaConfiguration } = await import('../src/platform/nativeBridge');
    expect((await importInstalledStremioConfiguration()).addons).toEqual([privateAddon]);
    // An imported stream-only configuration still gets the metadata default, so a
    // series can list episodes without the user configuring anything.
    expect(await readMediaConfiguration()).toEqual([privateAddon, bundled]);
    await disconnectMediaConfiguration();
    // Disconnect is a deliberate emptying: nothing is re-seeded afterwards.
    expect(await readMediaConfiguration()).toEqual([]);
    expect(invoke.mock.calls.filter(([name]) => name === 'media_configuration_add')).toHaveLength(1);
  });
});
