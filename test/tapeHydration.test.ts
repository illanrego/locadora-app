import { describe, expect, it, vi } from 'vitest';
import {
  createTapeHydration,
  isMetainfoUnresolved,
  type TapeHydration,
  type TapeHydrationProblem,
  type TapeHydrationResult,
} from '../src/rentals/tapeHydration';
import { emptyTapeManifest, type TapeManifest, type TapeRecord, type TapeState } from '../src/rentals/tapeManifest';
import { createTapeQueue, type TapeJob, type TapeJobSeed, type TapeQueue } from '../src/rentals/tapeQueue';
import { DEFAULT_TAPE_SETTINGS, type TapeSettings } from '../src/rentals/tapeSettings';
import { tapeCreateBody } from '../src/rentals/rentalTapePipeline';

const ORIGIN = 'http://127.0.0.1:11472';

/** A valid lower-case 40-hex infohash, unique per seed character. */
function hashOf(seed: string): string {
  const pair = (seed.charCodeAt(0) % 256).toString(16).padStart(2, '0');
  return pair.repeat(20);
}

function tape(state: TapeState, seed: string, overrides: Partial<TapeRecord> = {}): TapeRecord {
  const infoHash = hashOf(seed);
  return {
    rentalId: `rental-${seed}`,
    contentId: 'movie:tmdb:1',
    title: `Tape ${seed}`,
    infoHash,
    fileIdx: 2,
    fileName: 'feature.mkv',
    sizeBytes: 1_000_000,
    descriptor: { sources: ['udp://tracker.invalid:6969/announce'], magnet: `magnet:?xt=urn:btih:${infoHash}` },
    torrentBytesB64: null,
    state,
    addedAt: `2026-10-19T12:0${seed.charCodeAt(0) % 10}:00.000Z`,
    completedAt: state === 'ready' || state === 'seeding' ? '2026-10-19T12:30:00.000Z' : null,
    lastPlayedAt: null,
    ...overrides,
  };
}

function manifestOf(tapes: TapeRecord[]): TapeManifest {
  return { version: 1, tapes };
}

async function flush(): Promise<void> {
  for (let step = 0; step < 16; step += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function stubQueue(): { queue: Pick<TapeQueue, 'enqueue'>; enqueue: ReturnType<typeof vi.fn> } {
  const enqueue = vi.fn((seed: TapeJobSeed): TapeJob => ({
    ...seed,
    state: 'queued',
    readBytes: 0,
    totalBytes: null,
    attempts: 0,
    failureCode: null,
  }));
  return { queue: { enqueue }, enqueue };
}

interface Harness {
  hydration: TapeHydration;
  manifest: () => TapeManifest;
  writes: () => TapeManifest[];
  events: () => string[];
  ensureEngine: ReturnType<typeof vi.fn>;
  requestEngine: ReturnType<typeof vi.fn>;
  readManifest: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
  pump: ReturnType<typeof vi.fn>;
  problems: TapeHydrationProblem[];
}

function harness(options: {
  initial?: TapeManifest;
  settings?: Partial<TapeSettings>;
  /** Status per `/<hash>/create`, or a single status for every call. */
  status?: number | ((url: string) => number | Promise<number>);
  ensureEngine?: () => Promise<string>;
  readManifest?: () => Promise<TapeManifest>;
  writeManifest?: (manifest: TapeManifest) => Promise<void>;
  queue?: Pick<TapeQueue, 'enqueue'>;
  pump?: () => void;
} = {}): Harness {
  let stored: TapeManifest = JSON.parse(JSON.stringify(options.initial ?? emptyTapeManifest())) as TapeManifest;
  const writes: TapeManifest[] = [];
  const events: string[] = [];
  const problems: TapeHydrationProblem[] = [];
  const settings: TapeSettings = { ...DEFAULT_TAPE_SETTINGS, ...options.settings };

  const readManifest = vi.fn(async () => {
    events.push('read');
    if (options.readManifest) return options.readManifest();
    return JSON.parse(JSON.stringify(stored)) as TapeManifest;
  });
  const writeManifest = vi.fn(async (next: TapeManifest) => {
    events.push('write');
    if (options.writeManifest) {
      await options.writeManifest(next);
      return;
    }
    stored = JSON.parse(JSON.stringify(next)) as TapeManifest;
    writes.push(JSON.parse(JSON.stringify(next)) as TapeManifest);
  });
  const ensureEngine = vi.fn(async () => {
    events.push('ensure');
    if (options.ensureEngine) return options.ensureEngine();
    return ORIGIN;
  });
  const requestEngine = vi.fn(async (url: string, _method: string, _body?: string | null) => {
    events.push(`create:${url.slice(ORIGIN.length + 1, ORIGIN.length + 9)}`);
    if (typeof options.status === 'function') return { status: await options.status(url) };
    return { status: options.status ?? 200 };
  });

  const stub = stubQueue();
  const enqueue = vi.fn((seed: TapeJobSeed) => {
    events.push('enqueue');
    return (options.queue ?? stub.queue).enqueue(seed);
  });
  const pump = vi.fn(() => {
    events.push('pump');
    options.pump?.();
  });

  const hydration = createTapeHydration({
    settings: () => settings,
    readManifest,
    writeManifest,
    ensureEngine,
    requestEngine,
    createBody: tapeCreateBody,
    queue: { enqueue },
    pump,
    onProblem: (problem) => problems.push(problem),
  });

  return {
    hydration,
    manifest: () => JSON.parse(JSON.stringify(stored)) as TapeManifest,
    writes: () => writes,
    events: () => events,
    ensureEngine,
    requestEngine,
    readManifest,
    enqueue,
    pump,
    problems,
  };
}

describe('startup hydration: retained tapes survive a restart', () => {
  it('re-attaches every ready and seeding tape exactly once and starts the engine once', async () => {
    const readyA = tape('ready', 'a');
    const readyB = tape('ready', 'b', { descriptor: { sources: [], magnet: `magnet:?xt=urn:btih:${hashOf('b')}` } });
    const seeding = tape('seeding', 'c');
    const state = harness({ initial: manifestOf([readyA, readyB, seeding]) });

    const result = await state.hydration.hydrate();

    expect(result).toEqual({
      status: 'hydrated',
      reason: null,
      registered: 3,
      requeued: 0,
      unverified: 0,
      refused: 0,
    });
    expect(state.ensureEngine).toHaveBeenCalledTimes(1);
    expect(state.requestEngine).toHaveBeenCalledTimes(3);

    // The body is the pipeline's own: infoHash, no index guessing, dht plus the
    // row's trackers.
    const [url, method, body] = state.requestEngine.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/${readyA.infoHash}/create`);
    expect(method).toBe('POST');
    expect(JSON.parse(body as string)).toEqual(JSON.parse(tapeCreateBody(readyA.infoHash, readyA.descriptor.sources)));
    expect(JSON.parse(body as string).peerSearch.sources).toEqual([
      `dht:${readyA.infoHash}`,
      'tracker:udp://tracker.invalid:6969/announce',
    ]);
    // A row without trackers still searches by infohash alone.
    expect(JSON.parse(state.requestEngine.mock.calls[1][2] as string)).toEqual({
      torrent: { infoHash: readyB.infoHash },
      guessFileIdx: false,
    });
    // Registration is not a state change: nothing is written.
    expect(state.writes()).toHaveLength(0);
    expect(state.manifest().tapes.map((row) => row.state)).toEqual(['ready', 'ready', 'seeding']);
  });

  it('resets interrupted rows to queued, writes once and pumps the queue', async () => {
    const downloading = tape('downloading', 'd');
    const resolving = tape('resolving', 'e');
    const state = harness({ initial: manifestOf([downloading, resolving]) });

    const result = await state.hydration.hydrate();

    expect(result).toMatchObject({ status: 'hydrated', registered: 0, requeued: 2 });
    expect(state.writes()).toHaveLength(1);
    expect(state.writes()[0].tapes.map((row) => [row.infoHash, row.state])).toEqual([
      [downloading.infoHash, 'queued'],
      [resolving.infoHash, 'queued'],
    ]);
    expect(state.enqueue.mock.calls.map(([seed]) => (seed as TapeJobSeed).infoHash))
      .toEqual([downloading.infoHash, resolving.infoHash]);
    expect(state.pump).toHaveBeenCalledTimes(1);
    // Registration comes first, then the reset write, then the queue.
    expect(state.events().filter((event) => event !== 'read')).toEqual(['ensure', 'write', 'enqueue', 'enqueue', 'pump']);
  });

  it('re-queues a row that is already queued without writing the manifest', async () => {
    const queued = tape('queued', 'q');
    const state = harness({ initial: manifestOf([queued]) });

    const result = await state.hydration.hydrate();

    expect(result).toMatchObject({ requeued: 1 });
    expect(state.writes()).toHaveLength(0);
    expect(state.enqueue).toHaveBeenCalledTimes(1);
    expect(state.pump).toHaveBeenCalledTimes(1);
    expect(state.manifest().tapes[0].state).toBe('queued');
  });

  it('retries a failed row exactly once per launch, and a second failure is terminal', async () => {
    const failed = tape('failed', 'f');
    const start = vi.fn(async () => {
      throw { code: 'read-failed' };
    });
    const queue = createTapeQueue({ driver: { start, cancel: vi.fn() } });
    const enqueue = vi.fn((seed: TapeJobSeed) => queue.enqueue(seed));
    const state = harness({
      initial: manifestOf([failed]),
      queue: { enqueue },
      pump: () => { queue.startNext(); },
    });

    const result = await state.hydration.hydrate();
    await flush();

    // §9: the restart is the one extra attempt this launch.
    expect(result).toMatchObject({ requeued: 1 });
    expect(state.writes()[0].tapes[0].state).toBe('queued');
    expect(start).toHaveBeenCalledTimes(1);

    // The queue's own budget turns the first retryable failure into a retry.
    expect(queue.snapshot().queued.map((job) => job.infoHash)).toEqual([failed.infoHash]);
    queue.startNext();
    await flush();
    expect(start).toHaveBeenCalledTimes(2);
    expect(queue.attemptsFor(failed.infoHash)).toBe(2);
    expect(queue.snapshot().active).toBeNull();
    expect(queue.snapshot().queued).toHaveLength(0);

    // A second hydrate() in the same session never re-enqueues it.
    const again = await state.hydration.hydrate();
    expect(again).toBe(result);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('marks an unresolvable tape unverified and never retries it in a loop', async () => {
    const ready = tape('ready', 'g');
    const state = harness({ initial: manifestOf([ready]), status: 504 });

    const result = await state.hydration.hydrate();

    expect(result).toMatchObject({ status: 'hydrated', registered: 0, unverified: 1 });
    expect(state.manifest().tapes[0].state).toBe('unverified');
    expect(state.writes()).toHaveLength(1);
    expect(state.requestEngine).toHaveBeenCalledTimes(1);

    // A later call in the same session is the same run: no second registration.
    expect(await state.hydration.hydrate()).toBe(result);
    expect(state.requestEngine).toHaveBeenCalledTimes(1);
  });

  it('leaves a tape ready when the engine refuses for a reason that is not missing metainfo', async () => {
    const ready = tape('ready', 'h');
    const state = harness({ initial: manifestOf([ready]), status: 500 });

    const result = await state.hydration.hydrate();

    expect(result).toMatchObject({ registered: 0, unverified: 0, refused: 1 });
    expect(state.writes()).toHaveLength(0);
    expect(state.manifest().tapes[0].state).toBe('ready');
    expect(state.problems).toHaveLength(1);
    expect(state.problems[0].code).toBe('registration-refused');
    // A quiet line never carries an infohash, magnet or path.
    expect(state.problems[0].message).not.toContain(ready.infoHash);
    expect(state.problems[0].message).not.toContain(ready.descriptor.sources[0]);
  });

  it('starts neither the engine nor a request when the manifest is empty', async () => {
    const state = harness();

    const result = await state.hydration.hydrate();

    expect(result).toEqual({
      status: 'skipped',
      reason: 'manifest-empty',
      registered: 0,
      requeued: 0,
      unverified: 0,
      refused: 0,
    });
    expect(state.ensureEngine).not.toHaveBeenCalled();
    expect(state.requestEngine).not.toHaveBeenCalled();
    expect(state.writes()).toHaveLength(0);
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.pump).not.toHaveBeenCalled();
  });

  it('reads nothing at all when the master switch is off', async () => {
    const state = harness({ initial: manifestOf([tape('ready', 'i')]), settings: { enabled: false } });

    const result = await state.hydration.hydrate();

    expect(result).toMatchObject({ status: 'skipped', reason: 'tapes-disabled' });
    expect(state.readManifest).not.toHaveBeenCalled();
    expect(state.ensureEngine).not.toHaveBeenCalled();
    expect(state.requestEngine).not.toHaveBeenCalled();
    expect(state.writes()).toHaveLength(0);
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('runs once per session even when called twice at the same moment', async () => {
    const state = harness({ initial: manifestOf([tape('ready', 'j'), tape('downloading', 'k')]) });

    const [first, second] = await Promise.all([state.hydration.hydrate(), state.hydration.hydrate()]);

    expect(second).toBe(first);
    expect(state.readManifest).toHaveBeenCalledTimes(1);
    expect(state.ensureEngine).toHaveBeenCalledTimes(1);
    expect(state.requestEngine).toHaveBeenCalledTimes(1);
    expect(state.writes()).toHaveLength(1);
    expect(state.pump).toHaveBeenCalledTimes(1);
    expect(await state.hydration.hydrate()).toBe(first);
  });

  it('reports engine-unavailable and writes nothing when the engine cannot start', async () => {
    const ready = tape('ready', 'l');
    const state = harness({
      initial: manifestOf([ready, tape('downloading', 'm')]),
      ensureEngine: async () => { throw new Error('engine down'); },
    });

    const result = await state.hydration.hydrate();

    expect(result).toMatchObject({ status: 'skipped', reason: 'engine-unavailable' });
    expect(state.requestEngine).not.toHaveBeenCalled();
    expect(state.writes()).toHaveLength(0);
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.problems.map((problem) => problem.code)).toEqual(['engine-unavailable']);
  });

  it('stops the pass quietly when the bridge dies mid-run', async () => {
    const first = tape('ready', 'n');
    const second = tape('ready', 'o');
    let calls = 0;
    const state = harness({ initial: manifestOf([first, second]) });
    state.requestEngine.mockImplementation(async () => {
      calls += 1;
      if (calls > 1) throw new Error('bridge gone');
      return { status: 200 };
    });

    const result = await state.hydration.hydrate();

    expect(result).toMatchObject({ status: 'skipped', reason: 'engine-unavailable', registered: 1 });
    expect(state.requestEngine).toHaveBeenCalledTimes(2);
    expect(state.writes()).toHaveLength(0);
    expect(state.problems[0].code).toBe('engine-unavailable');
  });

  it('keeps going when the reset cannot be saved, because each job repersists itself', async () => {
    const state = harness({
      initial: manifestOf([tape('downloading', 'p')]),
      writeManifest: async () => { throw new Error('disk'); },
    });

    const result = await state.hydration.hydrate();

    expect(result).toMatchObject({ status: 'hydrated', requeued: 1 });
    expect(state.problems.map((problem) => problem.code)).toEqual(['manifest-write-failed']);
    expect(state.pump).toHaveBeenCalledTimes(1);
  });

  it('treats a read failure as a quiet skip', async () => {
    const state = harness({ readManifest: async () => { throw new Error('read-failed'); } });

    const result = await state.hydration.hydrate();

    expect(result).toMatchObject({ status: 'skipped', reason: 'manifest-unreadable' });
    expect(state.ensureEngine).not.toHaveBeenCalled();
    expect(state.problems[0].code).toBe('manifest-unreadable');
  });
});

describe('startup hydration: the metainfo rule', () => {
  it('reads only a metadata timeout as unresolvable metainfo', () => {
    expect(isMetainfoUnresolved(504)).toBe(true);
    expect(isMetainfoUnresolved(408)).toBe(true);
    expect(isMetainfoUnresolved(200)).toBe(false);
    expect(isMetainfoUnresolved(404)).toBe(false);
    expect(isMetainfoUnresolved(500)).toBe(false);
  });
});

describe('startup hydration: result shape', () => {
  it('never throws, even when the queue refuses a seed', async () => {
    const state = harness({ initial: manifestOf([tape('failed', 'r')]), queue: { enqueue: () => null } });

    const result: TapeHydrationResult = await state.hydration.hydrate();

    expect(result).toMatchObject({ status: 'hydrated', requeued: 0 });
    expect(state.pump).not.toHaveBeenCalled();
    expect(state.problems.map((problem) => problem.code)).toEqual(['invalid-row']);
  });
});
