// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TapeManifest } from '../src/rentals/tapeManifest';

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));

const HASH = 'a'.repeat(40);
const ORIGIN = 'http://127.0.0.1:11472';

function tape(overrides: Record<string, unknown> = {}) {
  return {
    rentalId: 'rental-1',
    contentId: 'movie:1',
    title: 'Synthetic fixture',
    infoHash: HASH,
    fileIdx: 3,
    fileName: 'fixture.mkv',
    sizeBytes: 1_610_612_736,
    descriptor: { sources: [`dht:${HASH}`], magnet: `magnet:?xt=urn:btih:${HASH}` },
    torrentBytesB64: null,
    state: 'ready',
    addedAt: '2026-10-19T12:00:00Z',
    completedAt: null,
    lastPlayedAt: null,
    ...overrides,
  };
}

function useNativeShell(present = true): void {
  const scope = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (present) scope.__TAURI_INTERNALS__ = {};
  else delete scope.__TAURI_INTERNALS__;
}

async function platform() {
  return import('../src/platform/tape');
}

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  listen.mockReset();
  window.localStorage.clear();
  useNativeShell();
});

describe('tape engine wrappers', () => {
  it('starts the engine and insists on the fixed 11472 origin', async () => {
    const tapePlatform = await platform();
    invoke.mockResolvedValueOnce({ url: ORIGIN });
    await expect(tapePlatform.ensureTapeEngine()).resolves.toBe(ORIGIN);
    expect(invoke).toHaveBeenLastCalledWith('tape_engine_ensure', { peerPort: 6881, maxSeedRatio: 0 });

    window.localStorage.setItem('locadora.tapes.peerPort', '0');
    window.localStorage.setItem('locadora.tapes.ratio', '1.5');
    invoke.mockResolvedValueOnce({ url: ORIGIN });
    await tapePlatform.ensureTapeEngine();
    expect(invoke).toHaveBeenLastCalledWith('tape_engine_ensure', { peerPort: 0, maxSeedRatio: 1.5 });

    invoke.mockResolvedValueOnce({ url: 'http://127.0.0.1:11471' });
    await expect(tapePlatform.ensureTapeEngine()).rejects.toMatchObject({ code: 'engine-unavailable' });
  });

  it('refuses a request the native allowlist would refuse, without invoking it', async () => {
    const tapePlatform = await platform();
    for (const url of [
      `http://127.0.0.1:11471/${HASH}/3`,
      `http://localhost:11472/${HASH}/3`,
      `http://127.0.0.1:11472/${HASH}/3?x=1`,
      `http://127.0.0.1:11472/${HASH}/3#frag`,
      `http://user:secret@127.0.0.1:11472/${HASH}/3`,
      `http://127.0.0.1:11472/${HASH.toUpperCase()}/3`,
      `http://127.0.0.1:11472/${HASH}/10000`,
      `http://127.0.0.1:11472/${HASH}/../settings`,
    ]) {
      await expect(tapePlatform.requestTapeEngine(url, 'GET')).rejects.toMatchObject({ code: 'invalid-request' });
    }
    await expect(tapePlatform.requestTapeEngine(`http://127.0.0.1:11472/${HASH}/3`, 'POST', '{}'))
      .rejects.toMatchObject({ code: 'invalid-request' });
    await expect(tapePlatform.requestTapeEngine(`http://127.0.0.1:11472/${HASH}/3`, 'GET', '{}'))
      .rejects.toMatchObject({ code: 'invalid-request' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('allows only the boolean seeding setting on the settings path', async () => {
    const tapePlatform = await platform();
    const settingsUrl = `${ORIGIN}/settings`;
    for (const [method, body] of [
      ['GET', null],
      ['POST', null],
      ['POST', '{}'],
      ['POST', '{"seedingEnabled":1}'],
      ['POST', '{"seedingEnabled":true,"cacheSize":null}'],
    ] as const) {
      await expect(tapePlatform.requestTapeEngine(settingsUrl, method, body))
        .rejects.toMatchObject({ code: 'invalid-request' });
    }
    invoke.mockResolvedValueOnce({ status: 200, body: '{"success":true}', contentType: 'application/json' });
    await expect(tapePlatform.requestTapeEngine(settingsUrl, 'POST', '{"seedingEnabled":false}'))
      .resolves.toMatchObject({ status: 200 });
  });

  it('does not POST a seeding setting while the tape engine is off', async () => {
    const tapePlatform = await platform();
    invoke.mockResolvedValueOnce(false);
    await expect(tapePlatform.setTapeSeedingEnabled(false)).resolves.toBe(false);
    expect(invoke.mock.calls).toEqual([['tape_engine_status']]);

    invoke.mockResolvedValueOnce(true);
    invoke.mockResolvedValueOnce({ status: 200, body: '{"success":true}', contentType: 'application/json' });
    await expect(tapePlatform.setTapeSeedingEnabled(false)).resolves.toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('tape_engine_request', {
      url: `${ORIGIN}/settings`, method: 'POST', body: '{"seedingEnabled":false}',
    });
  });

  it('passes an allowed request through and validates the answer', async () => {
    const tapePlatform = await platform();
    const create = `http://127.0.0.1:11472/${HASH}/create`;
    invoke.mockResolvedValueOnce({ status: 200, body: '{"ok":true}', contentType: 'application/json' });
    await expect(tapePlatform.requestTapeEngine(create, 'POST', '{}')).resolves.toEqual({
      status: 200, body: '{"ok":true}', contentType: 'application/json',
    });
    expect(invoke).toHaveBeenLastCalledWith('tape_engine_request', { url: create, method: 'POST', body: '{}' });

    invoke.mockResolvedValueOnce({ status: 200, body: '{}' });
    await expect(tapePlatform.requestTapeEngine(create, 'POST', '{}')).rejects.toMatchObject({ code: 'engine-unavailable' });
  });
});

describe('tape manifest wrappers', () => {
  it('reads a missing or corrupt manifest as the empty one', async () => {
    const tapePlatform = await platform();
    invoke.mockResolvedValueOnce(null);
    await expect(tapePlatform.readTapeManifest()).resolves.toEqual({ version: 1, tapes: [] });

    invoke.mockResolvedValueOnce({ version: 1, tapes: [tape(), tape({ infoHash: 'B'.repeat(40) })] });
    const manifest = await tapePlatform.readTapeManifest();
    expect(manifest.tapes.map((entry) => entry.infoHash)).toEqual([HASH]);
    expect(invoke).toHaveBeenLastCalledWith('tape_store_read');
  });

  it('refuses a lossy write and never sends it to the native side', async () => {
    const tapePlatform = await platform();
    // One row the native validator refuses: writing it would drop it silently.
    const invalid = { version: 1, tapes: [tape({ infoHash: 'B'.repeat(40) })] } as unknown as TapeManifest;
    await expect(tapePlatform.writeTapeManifest(invalid)).rejects.toMatchObject({ code: 'invalid-request' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('writes a valid manifest and can clear it', async () => {
    const tapePlatform = await platform();
    invoke.mockResolvedValue(undefined);
    const manifest = { version: 1 as const, tapes: [] };
    await tapePlatform.writeTapeManifest(manifest);
    expect(invoke).toHaveBeenLastCalledWith('tape_store_write', { manifest });
    await tapePlatform.clearTapeManifest();
    expect(invoke).toHaveBeenLastCalledWith('tape_store_clear');
  });
});

describe('tape download wrappers', () => {
  it('starts and cancels the native drain with camelCase arguments', async () => {
    const tapePlatform = await platform();
    invoke.mockResolvedValue(undefined);
    await tapePlatform.startTapeDownload(HASH, 3);
    expect(invoke).toHaveBeenLastCalledWith('tape_download_start', {
      infoHash: HASH, fileIdx: 3, peerPort: 6881, maxSeedRatio: 0,
    });
    await tapePlatform.cancelTapeDownload();
    expect(invoke).toHaveBeenLastCalledWith('tape_download_cancel');
  });

  it('refuses an impossible download request before invoking it', async () => {
    const tapePlatform = await platform();
    for (const [infoHash, fileIdx] of [['A'.repeat(40), 0], ['a'.repeat(39), 0], [HASH, 10_000], [HASH, -1], [HASH, 1.5]] as const) {
      await expect(tapePlatform.startTapeDownload(infoHash, fileIdx)).rejects.toMatchObject({ code: 'invalid-request' });
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('turns a native rejection into a typed, classifiable error', async () => {
    const tapePlatform = await platform();
    invoke.mockRejectedValueOnce({ code: 'torrent-not-found', message: 'The tape torrent or file was not found.' });
    const error = await tapePlatform.startTapeDownload(HASH, 3).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(tapePlatform.TapePlatformError);
    expect(error).toMatchObject({ code: 'torrent-not-found', message: 'The tape torrent or file was not found.' });

    invoke.mockRejectedValueOnce({ code: 'something-new', message: 'Unexpected' });
    await expect(tapePlatform.cancelTapeDownload()).rejects.toMatchObject({ code: 'read-failed' });
  });

  it('forwards only well-formed progress events', async () => {
    const tapePlatform = await platform();
    let handler: ((event: { payload: unknown }) => void) | null = null;
    const unlisten = vi.fn();
    listen.mockImplementation(async (_name: string, callback: typeof handler) => {
      handler = callback;
      return unlisten;
    });

    const received: unknown[] = [];
    const stop = await tapePlatform.onTapeDownloadProgress((event) => received.push(event));
    expect(listen).toHaveBeenCalledWith('tape-download-progress', expect.any(Function));
    expect(stop).toBe(unlisten);

    handler!({ payload: { infoHash: HASH, fileIdx: 3, readBytes: 10, totalBytes: 20, state: 'reading' } });
    handler!({ payload: { infoHash: 'B'.repeat(40), fileIdx: 3, readBytes: 10, totalBytes: 20, state: 'reading' } });
    handler!({ payload: 'nonsense' });
    expect(received).toEqual([{ infoHash: HASH, fileIdx: 3, readBytes: 10, totalBytes: 20, state: 'reading' }]);
  });

  it('builds the driver the queue expects', async () => {
    const tapePlatform = await platform();
    invoke.mockResolvedValue(undefined);
    const driver = tapePlatform.createTapeDownloadDriver();
    await driver.start(HASH, 0);
    expect(invoke).toHaveBeenLastCalledWith('tape_download_start', {
      infoHash: HASH, fileIdx: 0, peerPort: 6881, maxSeedRatio: 0,
    });
    await driver.cancel();
    expect(invoke).toHaveBeenLastCalledWith('tape_download_cancel');
  });

  it('keeps the engine and queue driver off when the master switch is false', async () => {
    window.localStorage.setItem('locadora.tapes.enabled', 'false');
    const tapePlatform = await platform();
    await expect(tapePlatform.ensureTapeEngine()).rejects.toMatchObject({ code: 'engine-unavailable' });
    await expect(tapePlatform.startTapeDownload(HASH, 0)).rejects.toMatchObject({ code: 'engine-unavailable' });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('outside the desktop shell', () => {
  it('reads as empty and refuses every action with a typed error', async () => {
    useNativeShell(false);
    const tapePlatform = await platform();
    await expect(tapePlatform.readTapeManifest()).resolves.toEqual({ version: 1, tapes: [] });
    await expect(tapePlatform.startTapeDownload(HASH, 0)).rejects.toMatchObject({ code: 'engine-unavailable' });
    await expect(tapePlatform.ensureTapeEngine()).rejects.toThrow('desktop app');
    await expect(tapePlatform.onTapeDownloadProgress(() => undefined)).resolves.toBeTypeOf('function');
    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });
});
