import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TAPE_ATTEMPTS_PER_SESSION,
  classifyTapeFailure,
  createTapeQueue,
  normalizeTapeDownloadProgress,
  type TapeJobSeed,
  type TapeQueueDriver,
  type TapeQueueEvent,
} from '../src/rentals/tapeQueue';

function hash(index: number): string {
  return index.toString(16).padStart(40, '0');
}

function seed(index: number, addedAt = '2026-10-19T12:00:00Z'): TapeJobSeed {
  return {
    infoHash: hash(index),
    fileIdx: 0,
    rentalId: `rental-${index}`,
    sizeBytes: 1_610_612_736,
    addedAt,
  };
}

/** Mimics the native command: the promise never settles until the terminal event. */
function pendingDriver() {
  return {
    start: vi.fn(async () => new Promise<void>(() => undefined)),
    cancel: vi.fn(async () => undefined),
  } satisfies TapeQueueDriver;
}

function rejectingDriver(code: string) {
  return {
    start: vi.fn(async () => {
      throw { code, message: 'Synthetic failure' };
    }),
    cancel: vi.fn(async () => undefined),
  } satisfies TapeQueueDriver;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function eventTypes(events: TapeQueueEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('tape queue order and the single active download', () => {
  it('runs first in first out by rent time, not by enqueue order', () => {
    const queue = createTapeQueue({ driver: pendingDriver() });
    queue.enqueue(seed(2, '2026-10-19T12:10:00Z'));
    queue.enqueue(seed(1, '2026-10-19T12:00:00Z'));
    queue.enqueue(seed(3, '2026-10-19T12:20:00Z'));

    expect(queue.nextJob()?.infoHash).toBe(hash(1));
    expect(queue.snapshot().queued.map((job) => job.infoHash)).toEqual([hash(1), hash(2), hash(3)]);
    expect(queue.startNext()?.infoHash).toBe(hash(1));
    expect(queue.nextJob()?.infoHash).toBe(hash(2));
  });

  it('keeps exactly one download active', () => {
    const driver = pendingDriver();
    const queue = createTapeQueue({ driver });
    queue.enqueue(seed(1));
    queue.enqueue(seed(2));

    expect(queue.startNext()?.infoHash).toBe(hash(1));
    expect(queue.startNext()).toBeNull();
    expect(driver.start).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().active?.state).toBe('resolving');
  });

  it('walks queued to resolving to downloading to ready', () => {
    const driver = pendingDriver();
    const events: TapeQueueEvent[] = [];
    const queue = createTapeQueue({ driver, onEvent: (event) => events.push(event) });
    queue.enqueue(seed(1));

    expect(queue.startNext()?.state).toBe('resolving');
    expect(driver.start).toHaveBeenCalledWith(hash(1), 0);

    queue.onProgress({ infoHash: hash(1), fileIdx: 0, readBytes: 100, totalBytes: 1_000, state: 'reading' });
    expect(queue.snapshot().active).toMatchObject({ state: 'downloading', readBytes: 100, totalBytes: 1_000 });

    queue.onProgress({ infoHash: hash(1), fileIdx: 0, readBytes: 1_000, totalBytes: 1_000, state: 'complete' });
    expect(queue.snapshot().active).toBeNull();
    expect(queue.snapshot().queued).toEqual([]);
    expect(eventTypes(events)).toEqual(['started', 'progress', 'completed']);
    expect(events[2].job.state).toBe('ready');
  });

  it('never lets progress move a job that is not the active download', () => {
    const queue = createTapeQueue({ driver: pendingDriver() });
    queue.enqueue(seed(1));
    queue.enqueue(seed(2));
    queue.startNext();

    // Another tape's completion, a stale hash and a foreign file index are all ignored.
    queue.onProgress({ infoHash: hash(2), fileIdx: 0, readBytes: 1_000, totalBytes: 1_000, state: 'complete' });
    queue.onProgress({ infoHash: hash(9), fileIdx: 0, readBytes: 1_000, totalBytes: 1_000, state: 'complete' });
    queue.onProgress({ infoHash: hash(1), fileIdx: 1, readBytes: 1_000, totalBytes: 1_000, state: 'complete' });

    expect(queue.snapshot().active).toMatchObject({ infoHash: hash(1), state: 'resolving', readBytes: 0 });
    expect(queue.snapshot().queued.map((job) => job.state)).toEqual(['queued']);

    // A ready job cannot be advanced again by a repeated terminal event.
    queue.onProgress({ infoHash: hash(1), fileIdx: 0, readBytes: 1_000, totalBytes: 1_000, state: 'complete' });
    queue.onProgress({ infoHash: hash(1), fileIdx: 0, readBytes: 2_000, totalBytes: null, state: 'reading' });
    expect(queue.snapshot().active).toBeNull();
    expect(queue.snapshot().queued).toHaveLength(1);
  });

  it('keeps reported progress monotonic and ignores a terminal event after a return', () => {
    const queue = createTapeQueue({ driver: pendingDriver() });
    queue.enqueue(seed(1));
    queue.startNext();

    queue.onProgress({ infoHash: hash(1), fileIdx: 0, readBytes: 500, totalBytes: 2_000, state: 'reading' });
    queue.onProgress({ infoHash: hash(1), fileIdx: 0, readBytes: 100, totalBytes: 2_000, state: 'reading' });
    expect(queue.snapshot().active?.readBytes).toBe(500);

    expect(queue.cancelForReturn(hash(1))?.state).toBe('returned');
    queue.onProgress({ infoHash: hash(1), fileIdx: 0, readBytes: 2_000, totalBytes: 2_000, state: 'complete' });
    expect(queue.snapshot().active).toBeNull();
  });

  it('refuses duplicate, malformed and impossible seeds', () => {
    const queue = createTapeQueue({ driver: pendingDriver() });
    expect(queue.enqueue(seed(1))).not.toBeNull();
    expect(queue.enqueue(seed(1))?.infoHash).toBe(hash(1));
    expect(queue.snapshot().queued).toHaveLength(1);

    expect(queue.enqueue({ ...seed(2), infoHash: 'A'.repeat(40) })).toBeNull();
    expect(queue.enqueue({ ...seed(2), fileIdx: 10_000 })).toBeNull();
    expect(queue.enqueue({ ...seed(2), sizeBytes: 0 })).toBeNull();
    expect(queue.enqueue({ ...seed(2), addedAt: '' })).toBeNull();
    expect(queue.snapshot().queued).toHaveLength(1);
  });
});

describe('tape queue retry-once', () => {
  it('retries a retryable failure once and then stops', async () => {
    const driver = rejectingDriver('read-failed');
    const events: TapeQueueEvent[] = [];
    const queue = createTapeQueue({ driver, onEvent: (event) => events.push(event) });
    queue.enqueue(seed(1));

    queue.startNext();
    await flush();
    expect(queue.snapshot().queued.map((job) => job.state)).toEqual(['queued']);
    expect(queue.snapshot().queued[0].attempts).toBe(1);
    expect(queue.snapshot().active).toBeNull();
    expect(eventTypes(events)).toEqual(['started', 'retry-queued']);

    queue.startNext();
    await flush();
    expect(queue.snapshot().queued).toEqual([]);
    expect(queue.snapshot().active).toBeNull();
    expect(eventTypes(events)).toEqual(['started', 'retry-queued', 'started', 'failed']);
    expect(events[3].job).toMatchObject({ state: 'failed', attempts: MAX_TAPE_ATTEMPTS_PER_SESSION });

    // The budget is spent: no third attempt exists in this session.
    expect(queue.startNext()).toBeNull();
    expect(queue.attemptsFor(hash(1))).toBe(MAX_TAPE_ATTEMPTS_PER_SESSION);
    expect(driver.start).toHaveBeenCalledTimes(2);
  });

  it('never retries a deterministic failure', async () => {
    for (const code of ['too-large', 'invalid-request', 'cancelled']) {
      const driver = rejectingDriver(code);
      const events: TapeQueueEvent[] = [];
      const queue = createTapeQueue({ driver, onEvent: (event) => events.push(event) });
      queue.enqueue(seed(1));
      queue.startNext();
      await flush();
      expect(eventTypes(events)).toEqual(['started', 'failed']);
      expect(queue.snapshot().queued).toEqual([]);
      expect(queue.startNext()).toBeNull();
    }
  });

  it('marks an unresolvable metainfo unverified instead of retrying', async () => {
    const queue = createTapeQueue({ driver: rejectingDriver('torrent-not-found') });
    const events: TapeQueueEvent[] = [];
    queue.subscribe((event) => events.push(event));
    queue.enqueue(seed(1));
    queue.startNext();
    await flush();

    expect(eventTypes(events)).toEqual(['started', 'failed']);
    expect(events[1].job.state).toBe('unverified');
    expect(queue.snapshot().queued).toEqual([]);
  });

  it('retries when the driver throws synchronously, and stops after the retry', () => {
    let calls = 0;
    const queue = createTapeQueue({
      driver: {
        start: () => {
          calls += 1;
          throw new Error('engine unavailable');
        },
        cancel: () => undefined,
      },
    });
    queue.enqueue(seed(1));
    queue.startNext();
    expect(queue.snapshot().queued.map((job) => job.state)).toEqual(['queued']);
    queue.startNext();
    expect(queue.snapshot().queued).toEqual([]);
    expect(queue.attemptsFor(hash(1))).toBe(2);
    expect(calls).toBe(2);
    expect(classifyTapeFailure(new Error('boom'))).toBe('read-failed');
  });

  it('sends a retried tape to the back, so another tape gets its turn first', async () => {
    const queue = createTapeQueue({ driver: rejectingDriver('read-failed') });
    queue.enqueue(seed(1));
    queue.enqueue(seed(2));

    queue.startNext();
    await flush();
    expect(queue.attemptsFor(hash(1))).toBe(1);
    expect(queue.attemptsFor(hash(2))).toBe(0);
    expect(queue.snapshot().queued.map((job) => job.infoHash)).toEqual([hash(2), hash(1)]);

    queue.startNext();
    await flush();
    expect(queue.attemptsFor(hash(2))).toBe(1);
    expect(queue.snapshot().queued.map((job) => job.infoHash)).toEqual([hash(1), hash(2)]);

    queue.startNext();
    await flush();
    expect(queue.attemptsFor(hash(1))).toBe(MAX_TAPE_ATTEMPTS_PER_SESSION);
    expect(queue.snapshot().queued.map((job) => job.infoHash)).toEqual([hash(2)]);
  });
});

describe('tape queue cancellation on return', () => {
  it('cancels the active job and leaves every other tape untouched', async () => {
    const driver = pendingDriver();
    const events: TapeQueueEvent[] = [];
    const queue = createTapeQueue({ driver, onEvent: (event) => events.push(event) });
    queue.enqueue(seed(1, '2026-10-19T12:00:00Z'));
    queue.enqueue(seed(2, '2026-10-19T12:10:00Z'));
    queue.enqueue(seed(3, '2026-10-19T12:20:00Z'));
    queue.startNext();

    const cancelled = queue.cancelForReturn(hash(1));
    expect(cancelled).toMatchObject({ infoHash: hash(1), state: 'returned' });
    expect(driver.cancel).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().active).toBeNull();
    expect(queue.snapshot().queued.map((job) => [job.infoHash, job.state])).toEqual([
      [hash(2), 'queued'],
      [hash(3), 'queued'],
    ]);
    expect(eventTypes(events)).toEqual(['started', 'cancelled']);
    expect(queue.startNext()?.infoHash).toBe(hash(2));
  });

  it('removes a queued job without touching the active download', () => {
    const driver = pendingDriver();
    const queue = createTapeQueue({ driver });
    queue.enqueue(seed(1));
    queue.enqueue(seed(2));
    queue.enqueue(seed(3));
    queue.startNext();

    expect(queue.cancelForReturn(hash(2))?.state).toBe('returned');
    expect(driver.cancel).not.toHaveBeenCalled();
    expect(queue.snapshot().active?.infoHash).toBe(hash(1));
    expect(queue.snapshot().queued.map((job) => job.infoHash)).toEqual([hash(3)]);
    expect(queue.cancelForReturn(hash(9))).toBeNull();
  });
});

describe('native progress payloads', () => {
  it('accepts the shape the native driver emits', () => {
    expect(normalizeTapeDownloadProgress({
      infoHash: hash(1), fileIdx: 3, readBytes: 10, totalBytes: 20, state: 'reading',
    })).toEqual({ infoHash: hash(1), fileIdx: 3, readBytes: 10, totalBytes: 20, state: 'reading' });
    expect(normalizeTapeDownloadProgress({
      infoHash: hash(1), fileIdx: 0, readBytes: 0, state: 'complete',
    })).toMatchObject({ totalBytes: null, state: 'complete' });
  });

  it('drops malformed payloads instead of trusting them', () => {
    const valid = { infoHash: hash(1), fileIdx: 0, readBytes: 1, totalBytes: null, state: 'reading' };
    for (const value of [
      null,
      'reading',
      [],
      { ...valid, infoHash: 'A'.repeat(40) },
      { ...valid, fileIdx: 10_000 },
      { ...valid, fileIdx: 1.5 },
      { ...valid, readBytes: -1 },
      { ...valid, readBytes: 1.5 },
      { ...valid, totalBytes: 0 },
      { ...valid, state: 'paused' },
      { ...valid, url: 'http://127.0.0.1:11472/aaa' },
      {},
    ]) {
      expect(normalizeTapeDownloadProgress(value)).toBeNull();
    }
  });
});
