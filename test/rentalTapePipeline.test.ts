import { describe, expect, it, vi } from 'vitest';
import { normalizeDiscoveryTitle, type DiscoveryTitle } from '../src/domain/content';
import type { StreamCandidate } from '../src/media/types';
import { createTapePlaybackWindow } from '../src/rentals/tapePlaybackWindow';
import {
  createRentalTapePipeline,
  tapeCreateBody,
  tapeMagnet,
  type RentalTapePipeline,
} from '../src/rentals/rentalTapePipeline';
import { emptyTapeManifest, normalizeManifest, type TapeManifest, type TapeRecord } from '../src/rentals/tapeManifest';
import { DEFAULT_TAPE_SETTINGS, type TapeSettings } from '../src/rentals/tapeSettings';

const ORIGIN = 'http://127.0.0.1:11472';
const GIB = 1024 ** 3;

function hash(seed: string): string {
  return seed.repeat(40).slice(0, 40);
}

function movie(tmdbId: number, name = `Movie ${tmdbId}`): DiscoveryTitle {
  return normalizeDiscoveryTitle({ tmdbId, imdbId: `tt${String(tmdbId).padStart(7, '0')}`, type: 'movie', name, year: 2020 })!;
}

function series(tmdbId: number, name = `Series ${tmdbId}`): DiscoveryTitle {
  return normalizeDiscoveryTitle({ tmdbId, imdbId: `tt${String(tmdbId).padStart(7, '0')}`, type: 'series', name, year: 2020 })!;
}

function candidate(infoHash: string, fileIdx: number | null, sizeBytes: number | null): StreamCandidate {
  return {
    stableId: `addon:${infoHash}`,
    addonId: 'addon-1',
    sourceName: 'The Pirate Bay',
    resolution: 1080,
    sizeBytes,
    seeders: 120,
    transportType: 'torrent',
    displayName: 'Movie.2020.1080p.BluRay.mkv',
    playbackDescriptor: { kind: 'torrent', infoHash, fileIndex: fileIdx, announce: ['udp://tracker.invalid:6969/announce'] },
    parseConfidence: 'complete',
    rejectionReasons: [],
  };
}

function confirmedRental(items: Array<{ id: string; tmdbId: number; type: 'movie' | 'series'; name: string }>) {
  return {
    rental: {
      id: 'rental-1',
      openedAt: '2026-10-19T12:00:00.000Z',
      items: items.map((item) => ({
        ...item,
        canonicalKey: `${item.type}:tmdb:${item.tmdbId}`,
        year: 2020,
        rentedAt: '2026-10-19T12:00:00.000Z',
      })),
    },
  };
}

async function flush(): Promise<void> {
  for (let step = 0; step < 16; step += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function clone(manifest: TapeManifest): TapeManifest {
  return JSON.parse(JSON.stringify(manifest)) as TapeManifest;
}

interface Harness {
  pipeline: RentalTapePipeline;
  manifest: () => TapeManifest;
  writes: () => number;
  settings: TapeSettings;
  readManifest: ReturnType<typeof vi.fn>;
  writeManifest: ReturnType<typeof vi.fn>;
  ensureEngine: ReturnType<typeof vi.fn>;
  requestEngine: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  resolveWinner: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
}

function harness(options: {
  winners?: Record<string, StreamCandidate | null>;
  settings?: Partial<TapeSettings>;
  initial?: TapeManifest;
  startImpl?: () => Promise<void>;
} = {}): Harness {
  let stored: TapeManifest = clone(options.initial ?? emptyTapeManifest());
  let writes = 0;
  const settings: TapeSettings = { ...DEFAULT_TAPE_SETTINGS, ...options.settings };

  const readManifest = vi.fn(async () => clone(stored));
  const writeManifest = vi.fn(async (next: TapeManifest) => {
    stored = clone(next);
    writes += 1;
  });
  const ensureEngine = vi.fn(async () => ORIGIN);
  const requestEngine = vi.fn(async () => ({ status: 200 }));
  const start = vi.fn(options.startImpl ?? (async () => new Promise<void>(() => undefined)));
  const cancel = vi.fn(async () => undefined);
  const resolveWinner = vi.fn(async (title: DiscoveryTitle) => options.winners?.[title.identity.canonicalKey] ?? null);
  const record = vi.fn();

  const pipeline = createRentalTapePipeline({
    settings: () => settings,
    readManifest,
    writeManifest,
    resolveWinner,
    ensureEngine,
    requestEngine,
    download: { start, cancel },
    now: () => '2026-10-19T12:00:00.000Z',
    diagnostics: { record },
  });

  return {
    pipeline,
    manifest: () => clone(stored),
    writes: () => writes,
    settings,
    readManifest,
    writeManifest,
    ensureEngine,
    requestEngine,
    start,
    cancel,
    resolveWinner,
    record,
  };
}

describe('rental → tape: a confirmed movie rental', () => {
  it('writes one queued row with its descriptor and starts exactly one download', async () => {
    const infoHash = hash('a');
    const title = movie(101, 'Big Buck Bunny');
    const state = harness({ winners: { 'movie:tmdb:101': candidate(infoHash, 3, 1_500_000_000) } });

    const attempts = await state.pipeline.enqueueRental(
      confirmedRental([{ id: 'item-1', tmdbId: 101, type: 'movie', name: 'Big Buck Bunny' }]),
      [title],
    );

    expect(attempts).toEqual([{ rentalId: 'item-1', contentId: 'movie:tmdb:101', outcome: 'enqueued', code: 'queued', infoHash }]);
    const rows = state.manifest().tapes;
    expect(rows).toHaveLength(1);
    const row: TapeRecord = rows[0];
    expect(row).toMatchObject({
      rentalId: 'item-1',
      contentId: 'movie:tmdb:101',
      title: 'Big Buck Bunny',
      infoHash,
      fileIdx: 3,
      sizeBytes: 1_500_000_000,
      torrentBytesB64: null,
      completedAt: null,
      lastPlayedAt: null,
    });
    expect(row.fileName).toBe('Movie.2020.1080p.BluRay.mkv');
    expect(row.descriptor.sources).toEqual(['udp://tracker.invalid:6969/announce']);
    expect(row.descriptor.magnet.startsWith(`magnet:?xt=urn:btih:${infoHash}`)).toBe(true);
    expect(row.descriptor.magnet).toContain('&tr=udp%3A%2F%2Ftracker.invalid%3A6969%2Fannounce');
    // The row must survive the native validator's own rules unchanged.
    expect(normalizeManifest(state.manifest()).tapes).toHaveLength(1);

    await flush();
    expect(state.ensureEngine).toHaveBeenCalledTimes(1);
    expect(state.requestEngine).toHaveBeenCalledTimes(1);
    const [url, method, body] = state.requestEngine.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/${infoHash}/create`);
    expect(method).toBe('POST');
    expect(JSON.parse(body as string)).toEqual({
      torrent: { infoHash },
      guessFileIdx: false,
      peerSearch: { sources: [`dht:${infoHash}`, 'tracker:udp://tracker.invalid:6969/announce'], min: 40, max: 200 },
    });
    expect(state.start).toHaveBeenCalledWith(infoHash, 3);
    expect(state.start).toHaveBeenCalledTimes(1);
    expect(state.record).toHaveBeenCalledWith({
      event: 'enqueue',
      contentId: 'movie:tmdb:101',
      sizeBytes: 1_500_000_000,
      infoHash,
    });
    // The row walks the queue's own states without a second writer.
    expect(state.manifest().tapes[0].state).toBe('resolving');
  });

  it('marks the row ready on completion and never guesses a file index', async () => {
    const infoHash = hash('b');
    const state = harness({ winners: { 'movie:tmdb:102': candidate(infoHash, 0, 500 * 1024 ** 2) } });

    await state.pipeline.enqueueRental(
      confirmedRental([{ id: 'item-2', tmdbId: 102, type: 'movie', name: 'Sintel' }]),
      [movie(102, 'Sintel')],
    );
    await flush();
    state.pipeline.queue.onProgress({ infoHash, fileIdx: 0, readBytes: 10, totalBytes: 20, state: 'reading' });
    await flush();
    expect(state.manifest().tapes[0].state).toBe('downloading');

    state.pipeline.queue.onProgress({ infoHash, fileIdx: 0, readBytes: 20, totalBytes: 20, state: 'complete' });
    await flush();
    expect(state.manifest().tapes[0]).toMatchObject({ state: 'ready', completedAt: '2026-10-19T12:00:00.000Z' });

    // An unknown index is a skip, not a guess.
    const unknown = harness({ winners: { 'movie:tmdb:103': candidate(hash('c'), null, 500 * 1024 ** 2) } });
    const attempts = await unknown.pipeline.enqueueRental(
      confirmedRental([{ id: 'item-3', tmdbId: 103, type: 'movie', name: 'Tears of Steel' }]),
      [movie(103, 'Tears of Steel')],
    );
    expect(attempts[0]).toMatchObject({ outcome: 'skipped', code: 'unknown-file-index' });
    expect(unknown.manifest().tapes).toHaveLength(0);
    expect(unknown.ensureEngine).not.toHaveBeenCalled();
  });

  it('starts nothing when Quick Watch has no confident winner', async () => {
    const state = harness({ winners: { 'movie:tmdb:104': null } });

    const attempts = await state.pipeline.enqueueRental(
      confirmedRental([{ id: 'item-4', tmdbId: 104, type: 'movie', name: 'Elephants Dream' }]),
      [movie(104, 'Elephants Dream')],
    );

    expect(attempts[0]).toMatchObject({ outcome: 'skipped', code: 'no-qualifying-source' });
    expect(state.manifest().tapes).toHaveLength(0);
    expect(state.writes()).toBe(0);
    expect(state.ensureEngine).not.toHaveBeenCalled();
    expect(state.requestEngine).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
  });

  it('leaves the rental alone and starts nothing when admission refuses', async () => {
    const infoHash = hash('d');
    const state = harness({
      settings: { maxGb: 1 },
      winners: { 'movie:tmdb:105': candidate(infoHash, 1, 1.5 * GIB) },
    });

    const attempts = await state.pipeline.enqueueRental(
      confirmedRental([{ id: 'item-5', tmdbId: 105, type: 'movie', name: 'Agent 327' }]),
      [movie(105, 'Agent 327')],
    );

    expect(attempts[0]).toMatchObject({ outcome: 'skipped', code: 'cap-exceeded' });
    expect(state.readManifest).toHaveBeenCalledTimes(1);
    expect(state.manifest()).toEqual(emptyTapeManifest());
    expect(state.ensureEngine).not.toHaveBeenCalled();
    expect(state.requestEngine).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
    expect(state.record.mock.calls).toEqual([
      [{ event: 'enqueue', contentId: 'movie:tmdb:105', sizeBytes: 1.5 * GIB, infoHash }],
      [{ event: 'admit-refused', contentId: 'movie:tmdb:105', infoHash, reason: 'cap-exceeded' }],
    ]);
  });

  it('skips a series rental: no episode is guessed', async () => {
    const infoHash = hash('e');
    const state = harness({ winners: { 'series:tmdb:201': candidate(infoHash, 0, 500 * 1024 ** 2) } });

    const attempts = await state.pipeline.enqueueRental(
      confirmedRental([{ id: 'item-6', tmdbId: 201, type: 'series', name: 'The Flash' }]),
      [series(201, 'The Flash')],
    );

    expect(attempts).toEqual([{
      rentalId: 'item-6',
      contentId: 'series:tmdb:201',
      outcome: 'skipped',
      code: 'series-out-of-scope',
    }]);
    expect(state.resolveWinner).not.toHaveBeenCalled();
    expect(state.manifest().tapes).toHaveLength(0);
    expect(state.start).not.toHaveBeenCalled();
  });

  it('does nothing at all when the master switch is off', async () => {
    const infoHash = hash('f');
    const state = harness({
      settings: { enabled: false },
      winners: { 'movie:tmdb:106': candidate(infoHash, 2, 500 * 1024 ** 2) },
    });

    const attempts = await state.pipeline.enqueueRental(
      confirmedRental([{ id: 'item-7', tmdbId: 106, type: 'movie', name: 'A Trip to the Moon' }]),
      [movie(106, 'A Trip to the Moon')],
    );

    expect(attempts).toEqual([{ rentalId: null, contentId: null, outcome: 'skipped', code: 'tapes-disabled' }]);
    expect(state.readManifest).not.toHaveBeenCalled();
    expect(state.resolveWinner).not.toHaveBeenCalled();
    expect(state.ensureEngine).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
  });

  it('sanitizes hostile titles and file names into a row the native writer accepts', async () => {
    const longName = 'A'.repeat(600);
    const state = harness({
      winners: {
        'movie:tmdb:130': {
          ...candidate(hash('7'), 0, 1024 ** 3),
          displayName: `Movie\u0001\u0007 ${longName}.mkv`,
        },
      },
    });
    const title = normalizeDiscoveryTitle({
      tmdbId: 130,
      imdbId: 'tt0000130',
      type: 'movie',
      name: 'Bad\u0000Title',
      year: 2020,
    })!;

    const attempts = await state.pipeline.enqueueRental(
      confirmedRental([{ id: 'item-8', tmdbId: 130, type: 'movie', name: title.name }]),
      [title],
    );

    expect(attempts[0].outcome).toBe('enqueued');
    const accepted = normalizeManifest(state.manifest());
    expect(accepted.tapes).toHaveLength(1);
    expect(accepted.tapes[0].title).not.toMatch(/[\u0000-\u001f]/);
    expect(accepted.tapes[0].fileName).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe('rental → tape: the queue keeps one active download', () => {
  const first = hash('1');
  const second = hash('2');

  function twoMovies(settings: Partial<TapeSettings> = {}) {
    return harness({
      settings,
      winners: {
        'movie:tmdb:111': candidate(first, 0, 500 * 1024 ** 2),
        'movie:tmdb:112': candidate(second, 1, 500 * 1024 ** 2),
      },
    });
  }

  const rental = () => confirmedRental([
    { id: 'item-a', tmdbId: 111, type: 'movie', name: 'First' },
    { id: 'item-b', tmdbId: 112, type: 'movie', name: 'Second' },
  ]);
  const titles = () => [movie(111, 'First'), movie(112, 'Second')];

  it('starts the first rental and leaves the second queued, then pumps it on completion', async () => {
    const state = twoMovies();
    const attempts = await state.pipeline.enqueueRental(rental(), titles());
    await flush();

    expect(attempts.map((attempt) => attempt.outcome)).toEqual(['enqueued', 'enqueued']);
    expect(state.start.mock.calls).toEqual([[first, 0]]);
    expect(state.pipeline.queue.snapshot().active?.infoHash).toBe(first);
    expect(state.pipeline.queue.snapshot().queued.map((job) => job.infoHash)).toEqual([second]);
    expect(state.manifest().tapes.map((row) => [row.infoHash, row.state])).toEqual([
      [first, 'resolving'],
      [second, 'queued'],
    ]);

    state.pipeline.queue.onProgress({ infoHash: first, fileIdx: 0, readBytes: 5, totalBytes: 5, state: 'complete' });
    await flush();

    expect(state.start.mock.calls).toEqual([[first, 0], [second, 1]]);
    expect(state.manifest().tapes.map((row) => [row.infoHash, row.state])).toEqual([
      [first, 'ready'],
      [second, 'resolving'],
    ]);
  });

  it('holds downloads during RAM playback and pumps them when the RAM path ends', async () => {
    const state = twoMovies();
    const window = createTapePlaybackWindow({
      queue: state.pipeline.queue,
      engineRunning: async () => true,
      postSeedingEnabled: async () => true,
      onNetworkAvailable: () => state.pipeline.pump(),
    });

    await window.playbackStarted(`http://127.0.0.1:11471/${first}/0`);

    const attempts = await state.pipeline.enqueueRental(rental(), titles());
    await flush();
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(['enqueued', 'enqueued']);
    expect(state.start).not.toHaveBeenCalled();
    expect(state.pipeline.queue.snapshot().queued).toHaveLength(2);

    await window.playbackEnded();
    await flush();
    expect(state.start.mock.calls).toEqual([[first, 0]]);
    expect(state.pipeline.queue.snapshot().queued.map((job) => job.infoHash)).toEqual([second]);
  });
});

describe('rental → tape: a return cleans the tape side only', () => {
  const infoHash = hash('9');

  function tapeWithRental(): TapeManifest {
    const row: TapeRecord = {
      rentalId: 'item-x',
      contentId: 'movie:tmdb:121',
      title: 'Rented',
      infoHash,
      fileIdx: 4,
      fileName: 'Rented.mkv',
      sizeBytes: 500 * 1024 ** 2,
      descriptor: { sources: ['udp://tracker.invalid:6969/announce'], magnet: `magnet:?xt=urn:btih:${infoHash}` },
      torrentBytesB64: null,
      state: 'ready',
      addedAt: '2026-10-19T12:00:00.000Z',
      completedAt: '2026-10-19T12:05:00.000Z',
      lastPlayedAt: null,
    };
    return { version: 1, tapes: [row] };
  }

  function returning(overrides: {
    ensureEngine?: () => Promise<string>;
    writeManifest?: (manifest: TapeManifest) => Promise<void>;
    initial?: TapeManifest;
  } = {}) {
    let stored: TapeManifest = clone(overrides.initial ?? emptyTapeManifest());
    const ensureEngine = vi.fn(overrides.ensureEngine ?? (async () => ORIGIN));
    const requestEngine = vi.fn(async () => ({ status: 200 }));
    const start = vi.fn(async () => new Promise<void>(() => undefined));
    const cancel = vi.fn(async () => undefined);
    const pipeline = createRentalTapePipeline({
      settings: () => ({ ...DEFAULT_TAPE_SETTINGS }),
      readManifest: async () => clone(stored),
      writeManifest: overrides.writeManifest ?? (async (next) => { stored = clone(next); }),
      resolveWinner: async () => candidate(infoHash, 4, 500 * 1024 ** 2),
      ensureEngine,
      requestEngine,
      download: { start, cancel },
      now: () => '2026-10-19T12:00:00.000Z',
    });
    return {
      pipeline,
      ensureEngine,
      requestEngine,
      start,
      cancel,
      manifest: () => clone(stored),
      enqueue: () => pipeline.enqueueRental(
        confirmedRental([{ id: 'item-x', tmdbId: 121, type: 'movie', name: 'Rented' }]),
        [movie(121, 'Rented')],
      ),
    };
  }

  it('cancels the active job, asks the engine to remove the torrent and deletes the row', async () => {
    const state = returning();
    await state.enqueue();
    await flush();
    expect(state.start).toHaveBeenCalledTimes(1);

    const release = await state.pipeline.release('item-x');
    await flush();

    expect(release).toEqual({ status: 'released', infoHash, removal: 'removed' });
    expect(state.cancel).toHaveBeenCalledTimes(1);
    expect(state.requestEngine).toHaveBeenLastCalledWith(`${ORIGIN}/${infoHash}/remove`, 'GET');
    expect(state.manifest().tapes).toHaveLength(0);
    expect(state.pipeline.queue.snapshot().active).toBeNull();
    expect(state.pipeline.queue.snapshot().queued).toHaveLength(0);
  });

  it('never throws into the return when the media side fails', async () => {
    const offline = returning({ ensureEngine: async () => { throw new Error('engine down'); } });
    await offline.enqueue();
    await flush();
    const release = await offline.pipeline.release('item-x');
    expect(release).toEqual({ status: 'released', infoHash, removal: 'engine-unavailable' });
    expect(offline.manifest().tapes).toHaveLength(0);

    const unwritable = returning({
      initial: tapeWithRental(),
      writeManifest: async () => { throw new Error('disk'); },
    });
    await expect(unwritable.pipeline.release('item-x')).resolves.toEqual({ status: 'failed', code: 'manifest-write-failed' });

    // An unknown rental is not an error either.
    await expect(offline.pipeline.release('item-missing')).resolves.toEqual({ status: 'absent' });
  });
});

describe('rental → tape: the manifest body', () => {
  it('mirrors the engine create body and bounds the magnet', () => {
    expect(JSON.parse(tapeCreateBody(hash('a'), []))).toEqual({
      torrent: { infoHash: hash('a') },
      guessFileIdx: false,
    });
    const magnet = tapeMagnet(hash('a'), 'Movie.mkv', ['udp://tracker.invalid:6969/announce']);
    expect(magnet.startsWith(`magnet:?xt=urn:btih:${hash('a')}&dn=`)).toBe(true);
    expect(tapeMagnet(hash('a'), 'x', ['udp://' + 'a'.repeat(9_000)]).length).toBeLessThanOrEqual(8_192);
  });
});
