/**
 * The rented-tape download queue (§9, §20 queue states, §21 P2b).
 *
 * One active download, first in first out by rent time, `queued → resolving →
 * downloading → ready`, with `failed`, `returned` and `unverified` as terminal
 * resting states. The queue never opens a socket: it is driven through an
 * injected `{ start, cancel }` driver, so the tests need no shell and no real
 * download, and the native `tape_download_start` command (which resolves only at
 * the terminal state) fits the interface unchanged.
 *
 * Two rules keep a bad connection from becoming a busy loop:
 * a job is retried at most once per tape per app session, and the queue never
 * starts a download on its own — every start is an explicit `startNext()`, so the
 * app decides when the network may be used (§2.1: playback > queue > seeding).
 */
import { MAX_FILE_IDX, isInfoHash, isTapeTimestamp, isTapeSize, type TapeState } from './tapeManifest';

/** The closed failure vocabulary of the native download driver. */
export type TapeFailureCode =
  | 'engine-unavailable'
  | 'torrent-not-found'
  | 'invalid-request'
  | 'read-failed'
  | 'too-large'
  | 'cancelled';

export const TAPE_FAILURE_CODES: readonly TapeFailureCode[] = [
  'engine-unavailable',
  'torrent-not-found',
  'invalid-request',
  'read-failed',
  'too-large',
  'cancelled',
];

/**
 * `engine-unavailable` and `read-failed` can plausibly succeed later; the rest are
 * deterministic for a given tape, so retrying them would only burn the session's
 * single retry.
 */
const RETRYABLE_FAILURES: readonly TapeFailureCode[] = ['engine-unavailable', 'read-failed'];

/** First attempt plus one retry, per tape, per app session. */
export const MAX_TAPE_ATTEMPTS_PER_SESSION = 2;

export function isRetryableTapeFailure(code: TapeFailureCode): boolean {
  return RETRYABLE_FAILURES.includes(code);
}

/**
 * Extracts a known failure code from a driver rejection, or `null` when the value
 * carries none. The native command rejects with `{ code, message }` and the
 * platform wrapper rebuilds that as a typed error carrying the same code.
 */
export function readTapeFailureCode(error: unknown): TapeFailureCode | null {
  const candidate = typeof error === 'string'
    ? error
    : typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof candidate === 'string' && (TAPE_FAILURE_CODES as readonly string[]).includes(candidate)
    ? candidate as TapeFailureCode
    : null;
}

/**
 * Classifies a driver rejection. Anything unrecognisable is treated as a read
 * failure, which is retryable once.
 */
export function classifyTapeFailure(error: unknown): TapeFailureCode {
  return readTapeFailureCode(error) ?? 'read-failed';
}

export type TapeDownloadState = 'reading' | 'complete' | 'cancelled' | 'failed';

const DOWNLOAD_STATES: readonly TapeDownloadState[] = ['reading', 'complete', 'cancelled', 'failed'];

/** Payload of the native `tape-download-progress` event (camelCase, `§20`). */
export interface TapeDownloadProgress {
  infoHash: string;
  fileIdx: number;
  readBytes: number;
  totalBytes: number | null;
  state: TapeDownloadState;
}

const PROGRESS_KEYS = new Set(['infoHash', 'fileIdx', 'readBytes', 'totalBytes', 'state']);

/**
 * Validates an event payload from the native side. `null` means "drop it": a
 * malformed event must never move a job, so the platform layer refuses it here
 * rather than passing a half-trusted object to the state machine.
 */
export function normalizeTapeDownloadProgress(value: unknown): TapeDownloadProgress | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 || !keys.every((key) => PROGRESS_KEYS.has(key))) return null;
  const infoHash = record.infoHash;
  if (!isInfoHash(infoHash)) return null;
  const fileIdx = record.fileIdx;
  if (typeof fileIdx !== 'number' || !Number.isInteger(fileIdx) || fileIdx < 0 || fileIdx > MAX_FILE_IDX) return null;
  const readBytes = record.readBytes;
  if (typeof readBytes !== 'number' || !Number.isSafeInteger(readBytes) || readBytes < 0) return null;
  const totalBytes = record.totalBytes ?? null;
  if (totalBytes !== null && (typeof totalBytes !== 'number' || !Number.isSafeInteger(totalBytes) || totalBytes <= 0)) {
    return null;
  }
  const state = record.state;
  if (typeof state !== 'string' || !(DOWNLOAD_STATES as readonly string[]).includes(state)) return null;
  return {
    infoHash,
    fileIdx,
    readBytes,
    totalBytes,
    state: state as TapeDownloadState,
  };
}

export interface TapeJobSeed {
  infoHash: string;
  fileIdx: number;
  /** Owned by the manifest row; the queue only carries it for the caller. */
  rentalId: string;
  sizeBytes: number;
  /** Rent time (ISO). The queue orders by it, ties keep enqueue order. */
  addedAt: string;
}

export interface TapeJob extends TapeJobSeed {
  state: TapeState;
  readBytes: number;
  totalBytes: number | null;
  attempts: number;
  failureCode: TapeFailureCode | null;
}

/** Injected so the queue itself never touches the native shell. */
export interface TapeQueueDriver {
  start(infoHash: string, fileIdx: number): Promise<void>;
  cancel(): Promise<void> | void;
}

export type TapeQueueEvent =
  | { type: 'started'; job: TapeJob }
  | { type: 'progress'; job: TapeJob }
  | { type: 'completed'; job: TapeJob }
  | { type: 'retry-queued'; job: TapeJob; code: TapeFailureCode }
  | { type: 'failed'; job: TapeJob; code: TapeFailureCode }
  | { type: 'cancelled'; job: TapeJob };

export interface TapeQueueSnapshot {
  active: TapeJob | null;
  queued: TapeJob[];
}

export interface TapeQueueOptions {
  driver: TapeQueueDriver;
  /** Timestamp source for `completedAt`; injectable for deterministic tests. */
  now?: () => string;
  onEvent?: (event: TapeQueueEvent) => void;
}

export interface TapeQueue {
  enqueue(seed: TapeJobSeed): TapeJob | null;
  nextJob(): TapeJob | null;
  startNext(): TapeJob | null;
  onProgress(event: TapeDownloadProgress): void;
  onFailure(code: TapeFailureCode): void;
  cancelForReturn(infoHash: string): TapeJob | null;
  snapshot(): TapeQueueSnapshot;
  attemptsFor(infoHash: string): number;
  subscribe(listener: (event: TapeQueueEvent) => void): () => void;
}

function copyJob(job: TapeJob): TapeJob {
  return { ...job };
}

function isValidSeed(seed: TapeJobSeed): boolean {
  return isInfoHash(seed.infoHash)
    && Number.isInteger(seed.fileIdx)
    && seed.fileIdx >= 0
    && seed.fileIdx <= MAX_FILE_IDX
    && isTapeSize(seed.sizeBytes)
    && isTapeTimestamp(seed.addedAt);
}

class TapeDownloadQueue implements TapeQueue {
  private readonly driver: TapeQueueDriver;
  private readonly now: () => string;
  private readonly listeners = new Set<(event: TapeQueueEvent) => void>();
  private readonly pending: TapeJob[] = [];
  /** Per tape per session: survives a return and a re-enqueue of the same hash. */
  private readonly attemptsByTape = new Map<string, number>();
  private activeJob: TapeJob | null = null;

  constructor(options: TapeQueueOptions) {
    this.driver = options.driver;
    this.now = options.now ?? (() => new Date().toISOString());
    if (options.onEvent) this.listeners.add(options.onEvent);
  }

  subscribe(listener: (event: TapeQueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  enqueue(seed: TapeJobSeed): TapeJob | null {
    if (!isValidSeed(seed)) return null;
    const existing = this.find(seed.infoHash);
    if (existing) return copyJob(existing);

    const job: TapeJob = {
      ...seed,
      state: 'queued',
      readBytes: 0,
      totalBytes: null,
      attempts: this.attemptsByTape.get(seed.infoHash) ?? 0,
      failureCode: null,
    };
    this.insert(job);
    return copyJob(job);
  }

  nextJob(): TapeJob | null {
    const head = this.pending[0];
    return head ? copyJob(head) : null;
  }

  /**
   * Takes the first job by rent time and hands it to the driver. Returns `null`
   * when a download is already active or nothing is queued. The job stays
   * `resolving` until the first byte proves otherwise; the outcome arrives as an
   * event, never as this return value.
   */
  startNext(): TapeJob | null {
    if (this.activeJob) return null;
    const job = this.pending.shift();
    if (!job) return null;

    const attempts = (this.attemptsByTape.get(job.infoHash) ?? 0) + 1;
    this.attemptsByTape.set(job.infoHash, attempts);
    job.attempts = attempts;
    job.failureCode = null;
    job.readBytes = 0;
    job.totalBytes = null;
    job.state = 'resolving';
    this.activeJob = job;
    this.emit({ type: 'started', job });

    let pending: Promise<void>;
    try {
      pending = this.driver.start(job.infoHash, job.fileIdx);
    } catch (error) {
      this.fail(job, classifyTapeFailure(error));
      return copyJob(job);
    }

    // The native command rejects only at the terminal state, so this is the
    // single failure path; a job that already left the slot is left alone.
    Promise.resolve(pending).catch((error: unknown) => {
      if (this.activeJob === job) this.fail(job, classifyTapeFailure(error));
    });
    return copyJob(job);
  }

  /**
   * Applies a native progress event. Only the active job may move, and only by a
   * `reading` event (which promotes `resolving` to `downloading`) or a `complete`
   * event. Everything else — an unknown hash, another tape's file index, a stale
   * event after a return, an event for a queued job — is ignored.
   */
  onProgress(event: TapeDownloadProgress): void {
    const job = this.activeJob;
    if (!job || job.infoHash !== event.infoHash || job.fileIdx !== event.fileIdx) return;
    if (job.state !== 'resolving' && job.state !== 'downloading') return;

    if (event.state === 'reading') {
      job.state = 'downloading';
      job.readBytes = Math.max(job.readBytes, event.readBytes);
      if (event.totalBytes !== null) job.totalBytes = event.totalBytes;
      this.emit({ type: 'progress', job });
      return;
    }

    if (event.state === 'complete') {
      job.readBytes = Math.max(job.readBytes, event.readBytes);
      if (event.totalBytes !== null) job.totalBytes = event.totalBytes;
      job.state = 'ready';
      this.activeJob = null;
      this.emit({ type: 'completed', job });
      return;
    }

    // A terminal `failed` or `cancelled` event carries no reason; the driver's
    // rejection does, and that is the one path that fails a job.
  }

  onFailure(code: TapeFailureCode): void {
    const job = this.activeJob;
    if (!job) return;
    this.fail(job, code);
  }

  /**
   * Removes one tape from the queue for a return and stops the drain when that
   * tape was the active one. Other jobs keep their order and their state; the
   * caller removes the engine torrent and the manifest row.
   */
  cancelForReturn(infoHash: string): TapeJob | null {
    const index = this.pending.findIndex((job) => job.infoHash === infoHash);
    if (index !== -1) {
      const [job] = this.pending.splice(index, 1);
      job.state = 'returned';
      this.emit({ type: 'cancelled', job });
      return copyJob(job);
    }

    const active = this.activeJob;
    if (!active || active.infoHash !== infoHash) return null;
    this.activeJob = null;
    active.state = 'returned';
    this.emit({ type: 'cancelled', job: active });
    try {
      Promise.resolve(this.driver.cancel()).catch(() => undefined);
    } catch {
      // A driver that cannot cancel has already lost the slot; the return stands.
    }
    return copyJob(active);
  }

  snapshot(): TapeQueueSnapshot {
    return {
      active: this.activeJob ? copyJob(this.activeJob) : null,
      queued: this.pending.map(copyJob),
    };
  }

  attemptsFor(infoHash: string): number {
    return this.attemptsByTape.get(infoHash) ?? 0;
  }

  private find(infoHash: string): TapeJob | null {
    if (this.activeJob?.infoHash === infoHash) return this.activeJob;
    return this.pending.find((job) => job.infoHash === infoHash) ?? null;
  }

  /** Ascending rent time; equal timestamps keep enqueue order. */
  private insert(job: TapeJob): void {
    const index = this.pending.findIndex((queued) => queued.addedAt > job.addedAt);
    if (index === -1) {
      this.pending.push(job);
      return;
    }
    this.pending.splice(index, 0, job);
  }

  private fail(job: TapeJob, code: TapeFailureCode): void {
    this.activeJob = null;
    job.failureCode = code;

    if (code === 'torrent-not-found') {
      // §8: metainfo cannot be re-resolved, so the tape is never assumed playable.
      job.state = 'unverified';
      this.emit({ type: 'failed', job, code });
      return;
    }

    const attempts = this.attemptsByTape.get(job.infoHash) ?? job.attempts;
    if (isRetryableTapeFailure(code) && attempts < MAX_TAPE_ATTEMPTS_PER_SESSION) {
      job.state = 'queued';
      this.insert(job);
      this.emit({ type: 'retry-queued', job, code });
      return;
    }

    job.state = 'failed';
    this.emit({ type: 'failed', job, code });
  }

  private emit(event: TapeQueueEvent): void {
    const payload = { ...event, job: copyJob(event.job) } as TapeQueueEvent;
    for (const listener of this.listeners) listener(payload);
  }
}

export function createTapeQueue(options: TapeQueueOptions): TapeQueue {
  return new TapeDownloadQueue(options);
}
