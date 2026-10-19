// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguredAddon } from '../src/platform/nativeBridge';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
const TORRENTIO = 'https://torrentio.strem.fun/manifest.json';
const OPENSUBTITLES = 'https://opensubtitles-v3.strem.io/manifest.json';
const SEED_KEY_PREFIX = 'locadora:default-media-seed-v1';

const bundledMeta: ConfiguredAddon = { id: 'com.linvo.cinemeta', name: 'Cinemeta', resources: ['meta'], supportsStreams: false, supportsSubtitles: false };
const bundledStream: ConfiguredAddon = { id: 'com.stremio.torrentio.addon', name: 'Torrentio', resources: ['stream'], supportsStreams: true, supportsSubtitles: false };
const bundledSubtitles: ConfiguredAddon = { id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3', resources: ['subtitles'], supportsStreams: false, supportsSubtitles: true };

const userStream: ConfiguredAddon = { id: 'user-stream', name: 'User stream', resources: ['stream'], supportsStreams: true, supportsSubtitles: false };
const userSubtitles: ConfiguredAddon = { id: 'user-subs', name: 'User subtitles', resources: ['subtitles'], supportsStreams: false, supportsSubtitles: true };
const userMeta: ConfiguredAddon = { id: 'user-meta', name: 'User metadata', resources: ['meta'], supportsStreams: false, supportsSubtitles: false };
const catalogOnly: ConfiguredAddon = { id: 'user-catalog', name: 'User catalogue', resources: ['catalog'], supportsStreams: false, supportsSubtitles: false };

const manifestAddons: Record<string, ConfiguredAddon> = {
  [CINEMETA]: bundledMeta,
  [TORRENTIO]: bundledStream,
  [OPENSUBTITLES]: bundledSubtitles,
};

interface FakeBackendOptions {
  initial?: ConfiguredAddon[];
  /** Manifest URLs whose add must fail, mimicking an unreachable manifest. */
  failFor?: readonly string[];
  /** The installed Stremio collection the import path would produce. */
  imported?: ConfiguredAddon[];
}

/**
 * A stand-in for the protected native media configuration: it appends on add,
 * filters on remove, empties on disconnect and keeps the caller's order.
 */
function createBackend(options: FakeBackendOptions = {}) {
  let addons = [...(options.initial ?? [])];
  const addedUrls: string[] = [];
  const commands: string[] = [];
  const failFor = new Set(options.failFor ?? []);

  const backend = {
    addedUrls,
    commands,
    current: () => [...addons],
    invoke: vi.fn(async (command: string, args?: { manifestUrl?: string; addonId?: string }) => {
      commands.push(command);
      if (command === 'media_configuration_status') return [...addons];
      if (command === 'media_configuration_add') {
        const manifestUrl = args?.manifestUrl ?? '';
        addedUrls.push(manifestUrl);
        if (failFor.has(manifestUrl)) throw new Error('manifest unreachable');
        addons = [...addons, manifestAddons[manifestUrl]];
        return [...addons];
      }
      if (command === 'media_configuration_remove') {
        addons = addons.filter((addon) => addon.id !== args?.addonId);
        return [...addons];
      }
      if (command === 'media_configuration_disconnect') {
        addons = [];
        return undefined;
      }
      if (command === 'media_configuration_import_stremio') {
        addons = [...(options.imported ?? [])];
        return { addons: [...addons], imported: addons.length, skipped: [], source: 'installed Stremio' };
      }
      throw new Error(`Unexpected command: ${command}`);
    }),
  };
  return backend;
}

async function useBackend(options: FakeBackendOptions = {}) {
  const backend = createBackend(options);
  invoke.mockImplementation(backend.invoke);
  const bridge = await import('../src/platform/nativeBridge');
  return { backend, ...bridge };
}

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  window.localStorage.clear();
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});

describe('default media configuration', () => {
  it('seeds all three bare public manifests into an empty profile in a fixed order', async () => {
    const { backend, readMediaConfiguration } = await useBackend();

    expect(await readMediaConfiguration()).toEqual([bundledMeta, bundledStream, bundledSubtitles]);
    expect(backend.addedUrls).toEqual([CINEMETA, TORRENTIO, OPENSUBTITLES]);
    // Every URL is a public manifest: no key, query string or userinfo.
    for (const url of backend.addedUrls) {
      expect(new URL(url).search).toBe('');
      expect(new URL(url).username).toBe('');
      expect(new URL(url).pathname).toBe('/manifest.json');
    }

    // The decision is recorded, so a second read adds nothing.
    expect(await readMediaConfiguration()).toEqual([bundledMeta, bundledStream, bundledSubtitles]);
    expect(backend.addedUrls).toHaveLength(3);
    expect(window.localStorage.getItem(`${SEED_KEY_PREFIX}:stream`)).toBe('1');
  });

  it('adds only the resources a stream-only configuration lacks, after it', async () => {
    const { backend, readMediaConfiguration } = await useBackend({ initial: [userStream] });

    expect(await readMediaConfiguration()).toEqual([userStream, bundledMeta, bundledSubtitles]);
    expect(backend.addedUrls).toEqual([CINEMETA, OPENSUBTITLES]);
    // A user's own stream add-on — debrid-configured or not — is never doubled
    // by the public Torrentio default.
    expect(backend.addedUrls).not.toContain(TORRENTIO);

    expect(await readMediaConfiguration()).toEqual([userStream, bundledMeta, bundledSubtitles]);
    expect(backend.addedUrls).toHaveLength(2);
  });

  it('adds nothing when the configuration already answers all three resources', async () => {
    const initial = [userMeta, userStream, userSubtitles];
    const { backend, readMediaConfiguration } = await useBackend({ initial });

    expect(await readMediaConfiguration()).toEqual(initial);
    expect(backend.addedUrls).toEqual([]);
    expect(backend.commands).toEqual(['media_configuration_status']);
  });

  it('adds all three after a catalogue-only configuration without reordering it', async () => {
    const { backend, readMediaConfiguration } = await useBackend({ initial: [catalogOnly] });

    expect(await readMediaConfiguration()).toEqual([catalogOnly, bundledMeta, bundledStream, bundledSubtitles]);
    expect(backend.addedUrls).toEqual([CINEMETA, TORRENTIO, OPENSUBTITLES]);
  });

  it('seeds only the missing resources and keeps a mixed configuration in order', async () => {
    const initial = [catalogOnly, userSubtitles];
    const { backend, readMediaConfiguration } = await useBackend({ initial });

    expect(await readMediaConfiguration()).toEqual([catalogOnly, userSubtitles, bundledMeta, bundledStream]);
    expect(backend.addedUrls).toEqual([CINEMETA, TORRENTIO]);
  });

  it('does not undo a deliberate removal on the next read while the others still seed', async () => {
    // The user's own Torrentio is the only add-on; removing it decides `stream`
    // for good, but `meta` and `subtitles` were never decided and still seed.
    const { backend, readMediaConfiguration, removeMediaConfiguration } = await useBackend({ initial: [userStream] });

    expect(await removeMediaConfiguration(userStream.id)).toEqual([]);
    expect(window.localStorage.getItem(`${SEED_KEY_PREFIX}:stream`)).toBe('1');
    expect(window.localStorage.getItem(`${SEED_KEY_PREFIX}:meta`)).toBeNull();
    expect(window.localStorage.getItem(`${SEED_KEY_PREFIX}:subtitles`)).toBeNull();

    expect(await readMediaConfiguration()).toEqual([bundledMeta, bundledSubtitles]);
    expect(backend.addedUrls).toEqual([CINEMETA, OPENSUBTITLES]);

    // And it stays removed on every later read.
    expect(await readMediaConfiguration()).toEqual([bundledMeta, bundledSubtitles]);
    expect(backend.addedUrls).toEqual([CINEMETA, OPENSUBTITLES]);
  });

  it('does not re-seed a bundled default that the user removed', async () => {
    const { backend, readMediaConfiguration, removeMediaConfiguration } = await useBackend();
    expect(await readMediaConfiguration()).toEqual([bundledMeta, bundledStream, bundledSubtitles]);

    expect(await removeMediaConfiguration(bundledStream.id)).toEqual([bundledMeta, bundledSubtitles]);
    expect(await readMediaConfiguration()).toEqual([bundledMeta, bundledSubtitles]);
    expect(backend.addedUrls).toEqual([CINEMETA, TORRENTIO, OPENSUBTITLES]);
  });

  it('records nothing for a failed add and never loops on it inside one read', async () => {
    const { backend, readMediaConfiguration } = await useBackend({ failFor: [TORRENTIO] });

    // The other two defaults are independent decisions and still land.
    expect(await readMediaConfiguration()).toEqual([bundledMeta, bundledSubtitles]);
    expect(backend.addedUrls).toEqual([CINEMETA, TORRENTIO, OPENSUBTITLES]);
    expect(window.localStorage.getItem(`${SEED_KEY_PREFIX}:meta`)).toBe('1');
    expect(window.localStorage.getItem(`${SEED_KEY_PREFIX}:subtitles`)).toBe('1');
    // A failed attempt is not a decision: nothing is recorded for it.
    expect(window.localStorage.getItem(`${SEED_KEY_PREFIX}:stream`)).toBeNull();

    // A later read may try that one again — once, not in a loop.
    expect(await readMediaConfiguration()).toEqual([bundledMeta, bundledSubtitles]);
    expect(backend.addedUrls).toEqual([CINEMETA, TORRENTIO, OPENSUBTITLES, TORRENTIO]);
  });

  it('keeps explicit disconnect empty and preserves the read-only import path', async () => {
    const { backend, importInstalledStremioConfiguration, disconnectMediaConfiguration, readMediaConfiguration } = await useBackend({
      initial: [bundledMeta],
      imported: [userStream],
    });

    expect((await importInstalledStremioConfiguration()).addons).toEqual([userStream]);
    // Import records nothing: an imported stream-only collection still gets the
    // metadata and subtitle defaults it cannot answer.
    expect(await readMediaConfiguration()).toEqual([userStream, bundledMeta, bundledSubtitles]);
    await disconnectMediaConfiguration();
    // Disconnect is a deliberate emptying: nothing is re-seeded afterwards.
    expect(await readMediaConfiguration()).toEqual([]);
    expect(backend.addedUrls).toEqual([CINEMETA, OPENSUBTITLES]);
  });

  it('adds a user-supplied manifest without recording a seed decision', async () => {
    const { backend, addMediaConfiguration, readMediaConfiguration } = await useBackend();

    expect(await addMediaConfiguration(CINEMETA)).toEqual([bundledMeta]);
    // Adding by hand is not a seeding decision, so the untouched resources still
    // seed on the next read.
    expect(await readMediaConfiguration()).toEqual([bundledMeta, bundledStream, bundledSubtitles]);
    expect(backend.addedUrls).toEqual([CINEMETA, TORRENTIO, OPENSUBTITLES]);
  });

  it('ignores the superseded all-or-nothing seed flag', async () => {
    // The previous build kept one flag for every decision. It cannot say which
    // resource it settled, so the configuration itself decides: an empty one is
    // seeded again rather than left without metadata, streams or subtitles.
    window.localStorage.setItem(SEED_KEY_PREFIX, '1');
    const { readMediaConfiguration } = await useBackend();

    expect(await readMediaConfiguration()).toEqual([bundledMeta, bundledStream, bundledSubtitles]);
  });
});
