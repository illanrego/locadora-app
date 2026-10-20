/**
 * P8: startup hydration — the retained-tape half of §8 "app restart".
 *
 * The manifest and the files survive a restart, but the tape engine does not:
 * it is a child process, so a `ready` tape's torrent is gone from engine B the
 * moment the app closes. Without re-attaching it, a retained tape neither plays
 * from disk (the direct 11472 load 404s and playback falls back to streaming)
 * nor seeds. This module is that one step, once per session:
 *
 *   master switch off  -> nothing is read and nothing is started
 *   empty manifest     -> nothing is started (the app never pays for the feature
 *                         when there is nothing to serve)
 *   `tape_engine_ensure()` once
 *   every `ready` / `seeding` row -> POST `/<hash>/create` with the pipeline's
 *     own body, so the finished file is servable and seeder-able again
 *   `queued` / `resolving` / `downloading` rows -> `queued` (their attempt died
 *     with the old process) and handed to the runtime queue
 *   `failed` rows -> the same reset, which is §9's "retried once on the next
 *     launch"; the queue's own budget keeps a second failure in this launch
 *     terminal
 *   a registration that cannot resolve metainfo -> row `unverified`, never
 *     deleted, never retried in a loop, playback keeps falling back to the RAM
 *     path
 *
 * Rules this module keeps:
 *
 * - Idempotent and single-flight: the first call starts the run and every later
 *   call in this session returns that same result. The guard is taken *before*
 *   any await, so React's double effect cannot start the engine twice.
 * - Non-blocking and quiet: nothing here renders, throws or reports a user
 *   error. A refused or failed step becomes one bounded problem line carrying
 *   no infohash, magnet, tracker or path.
 * - Non-destructive: a row is only ever moved by `touchTape`, and a write
 *   happens only when at least one row actually changed. Rows that already
 *   `queued` are re-queued without a write.
 * - The engine is never touched when the switch is off or the manifest is empty,
 *   and it is never started by the queue's own driver: registration and reset
 *   are two separate steps, registration first, so the queue never downloads
 *   while a retained tape is being re-attached (§2.1: one network activity).
 *
 * Choices this brief left open, all deliberate:
 *
 * - The once-per-session guard is spent even when the switch is off. A switch
 *   turned on mid-session hydrates at the next launch; the alternative would let
 *   a run start the engine and seed minutes later, in the middle of a RAM
 *   playback the P4 window had deliberately silenced.
 * - A registration the engine refuses for a reason that is not missing metainfo
 *   (any status other than 408/504, e.g. 500) leaves the row `ready`: the file
 *   is still on disk and only the engine was unwell, so marking it `unverified`
 *   would understate what is kept. It is counted and reported, never retried.
 * - A bridge failure mid-run stops the registration pass instead of hammering a
 *   dead engine; the run then reports `engine-unavailable` and writes nothing.
 * - A failed manifest write is reported but does not stop the queue: every job
 *   start persists its own state, so the row is repaired by the next write
 *   rather than lost.
 */
import { touchTape, type TapeManifest, type TapeState } from './tapeManifest';
import type { TapeJobSeed, TapeQueue } from './tapeQueue';
import type { TapeSettings } from './tapeSettings';

/** A row whose finished file only needs its torrent re-attached. */
const SERVABLE_STATES: readonly TapeState[] = ['ready', 'seeding'];
/** A row whose previous attempt died with the old process. */
const RESTART_STATES: readonly TapeState[] = ['queued', 'resolving', 'downloading', 'failed'];

/**
 * The engine answers `/{hash}/create` with 504 when `Engine.Ready` times out,
 * which for a retained tape means the metainfo could not be re-fetched (§20).
 */
const METAINFO_UNRESOLVED_STATUSES: readonly number[] = [408, 504];

export function isMetainfoUnresolved(status: number): boolean {
  return METAINFO_UNRESOLVED_STATUSES.includes(status);
}

/** Why a run did nothing. `null` on a run that did the work. */
export type TapeHydrationReason =
  | 'already-hydrated'
  | 'tapes-disabled'
  | 'manifest-empty'
  | 'manifest-unreadable'
  | 'engine-unavailable';

export interface TapeHydrationProblem {
  code:
    | 'engine-unavailable'
    | 'manifest-unreadable'
    | 'registration-refused'
    | 'manifest-write-failed'
    | 'invalid-row';
  /** Bounded, redacted prose: never an infohash, tracker, magnet or path. */
  message: string;
}

export interface TapeHydrationResult {
  status: 'hydrated' | 'skipped';
  reason: TapeHydrationReason | null;
  /** `ready` / `seeding` rows whose torrent is attached again. */
  registered: number;
  /** Rows reset to `queued` and handed to the runtime queue. */
  requeued: number;
  /** Rows whose metainfo could not be resolved, marked `unverified`. */
  unverified: number;
  /** Rows the engine refused for a reason that is not missing metainfo. */
  refused: number;
}

export interface TapeHydrationEngineResponse {
  status: number;
}

export interface TapeHydrationDependencies {
  /** Sampled once, before anything is read or started. */
  settings: () => TapeSettings;
  readManifest: () => Promise<TapeManifest>;
  writeManifest: (manifest: TapeManifest) => Promise<void>;
  /** `tape_engine_ensure()`: lazily starts engine B and returns its origin. */
  ensureEngine: () => Promise<string>;
  requestEngine: (url: string, method: 'GET' | 'POST', body?: string | null) => Promise<TapeHydrationEngineResponse>;
  /** The pipeline's own `/<hash>/create` body, shared so there is one shape. */
  createBody: (infoHash: string, sources: readonly string[]) => string;
  /**
   * The runtime queue, reached lazily: a manifest with nothing to restart must
   * not build the queue (and its native progress subscription) either.
   */
  queue: Pick<TapeQueue, 'enqueue'>;
  pump: () => void;
  onProblem?: (problem: TapeHydrationProblem) => void;
}

export interface TapeHydration {
  /** Runs once per session; every later call returns the first result. */
  hydrate(): Promise<TapeHydrationResult>;
}

function skipped(reason: TapeHydrationReason, overrides: Partial<TapeHydrationResult> = {}): TapeHydrationResult {
  return { status: 'skipped', reason, registered: 0, requeued: 0, unverified: 0, refused: 0, ...overrides };
}

export function createTapeHydration(dependencies: TapeHydrationDependencies): TapeHydration {
  const problem = (code: TapeHydrationProblem['code'], message: string): void => {
    dependencies.onProblem?.({ code, message });
  };

  // Taken synchronously, so a second call in the same tick (StrictMode) shares
  // this run instead of starting engine B again.
  let run: Promise<TapeHydrationResult> | null = null;

  async function attempt(): Promise<TapeHydrationResult> {
    // The master switch is checked before any read, any engine start and any
    // write, so "off" costs nothing.
    if (!dependencies.settings().enabled) return skipped('tapes-disabled');

    let manifest: TapeManifest;
    try {
      manifest = await dependencies.readManifest();
    } catch {
      problem('manifest-unreadable', 'Retained tapes could not be read at startup.');
      return skipped('manifest-unreadable');
    }
    // Empty manifest: engine B is never started (§8, P8 guarantee).
    if (manifest.tapes.length === 0) return skipped('manifest-empty');

    let origin: string;
    try {
      origin = await dependencies.ensureEngine();
    } catch {
      problem('engine-unavailable', 'The tape engine did not start at startup.');
      return skipped('engine-unavailable');
    }

    // 1. Re-attach every retained finished tape: this is what makes the file
    // servable from disk and seeder-able again.
    let registered = 0;
    let refused = 0;
    const unverified: string[] = [];
    for (const tape of manifest.tapes) {
      if (!SERVABLE_STATES.includes(tape.state)) continue;
      let status: number;
      try {
        const response = await dependencies.requestEngine(
          `${origin}/${tape.infoHash}/create`,
          'POST',
          dependencies.createBody(tape.infoHash, tape.descriptor.sources),
        );
        status = response.status;
      } catch {
        // The engine went away mid-run: stopping beats hammering it, and the
        // rows keep the state they had (nothing is written).
        problem('engine-unavailable', 'The tape engine stopped while restarting retained tapes.');
        return skipped('engine-unavailable', { registered, refused });
      }
      if (status >= 200 && status < 300) {
        registered += 1;
        continue;
      }
      if (isMetainfoUnresolved(status)) {
        // §8: metainfo cannot be re-resolved. Keep the row, never assume the
        // copy is playable, and never retry it in a loop.
        unverified.push(tape.infoHash);
        continue;
      }
      refused += 1;
      problem('registration-refused', 'The tape engine refused to re-attach a retained tape.');
    }

    // 2. Apply the row changes in one snapshot, then write once.
    let next = manifest;
    let changed = false;
    for (const infoHash of unverified) {
      const touched = touchTape(next, infoHash, { state: 'unverified' });
      if (!touched) {
        problem('invalid-row', 'A tape row could not be marked unverified.');
        continue;
      }
      next = touched;
      changed = true;
    }

    const restart = next.tapes.filter((tape) => RESTART_STATES.includes(tape.state));
    const seeds: TapeJobSeed[] = [];
    for (const tape of restart) {
      const touched = touchTape(next, tape.infoHash, { state: 'queued' });
      if (!touched) {
        problem('invalid-row', 'A tape row could not be reset for this session.');
        continue;
      }
      next = touched;
      // A row that is already `queued` did not change: it is re-queued below
      // without a write.
      if (tape.state !== 'queued') changed = true;
      seeds.push({
        infoHash: tape.infoHash,
        fileIdx: tape.fileIdx,
        rentalId: tape.rentalId,
        sizeBytes: tape.sizeBytes,
        addedAt: tape.addedAt,
      });
    }

    if (changed) {
      try {
        await dependencies.writeManifest(next);
      } catch {
        // Reported, not fatal: each job start persists its own state.
        problem('manifest-write-failed', 'Retained tapes could not be saved at startup.');
      }
    }

    // 3. Hand the restarted rows to the one runtime queue and let it advance.
    let requeued = 0;
    for (const seed of seeds) {
      if (!dependencies.queue.enqueue(seed)) {
        problem('invalid-row', 'A retained tape could not be queued for this session.');
        continue;
      }
      requeued += 1;
    }
    if (requeued > 0) dependencies.pump();

    return {
      status: 'hydrated',
      reason: null,
      registered,
      requeued,
      unverified: unverified.length,
      refused,
    };
  }

  return {
    hydrate(): Promise<TapeHydrationResult> {
      run ??= attempt().catch((): TapeHydrationResult => {
        problem('invalid-row', 'Retained tapes could not be restored at startup.');
        return skipped('manifest-unreadable');
      });
      return run;
    },
  };
}
