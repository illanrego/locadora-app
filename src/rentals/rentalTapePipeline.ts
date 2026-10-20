/**
 * P5: the missing link between a confirmed rental and the rented-tape pipeline.
 *
 * A rental is the source of truth and only the rental service writes it. This
 * module reads the confirmed rental the app just created, offers each **movie**
 * to the tape pipeline, and then forgets about rentals entirely: the direction
 * is rental → tape, never tape → rental (§5).
 *
 * The chain for one movie, in order (§5/§9):
 *
 *   master switch `locadora.tapes.enabled`
 *     -> source chosen by the existing movie Quick Watch evaluator
 *        (`resolveTitleMedia`, which runs `normalizeStreams` + `selectQuickWatch`
 *        with the movie-v1 ladder; this module owns no second chooser)
 *     -> `admitTape` against `locadora.tapes.maxGb` and the manifest total
 *     -> manifest row written through `tape_store_write` with its descriptor
 *     -> `tape_engine_ensure()` -> `POST /<hash>/create` -> `tape_download_start`
 *     -> `tape-download-progress` events -> row `ready` on completion
 *
 * A refusal never touches the rental, never starts engine B and never deletes a
 * tape: the rental simply stays stream-only (§9).
 *
 * Choices this brief left open, all deliberate:
 *
 * - A rental whose Quick Watch evaluation has no winner, whose winner is not a
 *   torrent, or whose winner has no known file index gets **no manifest row**.
 *   A `failed` row would occupy an admission slot (all states except `returned`
 *   count) and would claim a download that was never attempted; §9 says such a
 *   tape "stays stream-only". The typed outcome carries the reason instead.
 * - The file index must be present. `tape_download_start` drains exactly one
 *   index and the manifest row needs one; guessing an index would download a
 *   file the user did not rent.
 * - `fileName` falls back to the add-on's own display label because the
 *   normalizer folds `behaviorHints.filename` into `displayName`; no separate
 *   file name reaches TypeScript.
 * - `torrentBytesB64` is always `null`: `RawAddonStream`/`StreamCandidate` carry
 *   no raw `.torrent` payload, so the row persists infohash + trackers and is
 *   re-created from DHT at launch (§20 metainfo rule).
 * - Removal uses `GET /<hash>/remove`, not POST. The frozen native bridge
 *   (`tape_request_allowed` in `src-tauri/src/streaming_engine.rs`) allows POST
 *   only on `/create` and `/settings`; the engine's removal shape is a GET and
 *   the native allowlist accepts exactly that. Rust is untouched.
 * - Completion marks the row `ready`. The committed native driver emits no
 *   "seeding" signal, so the row is left `ready` (§21 P5 allows this); the
 *   engine keeps seeding on its own (§11).
 * - A return **deletes** the row (`removeTape`), matching §8's "manifest row
 *   deleted; space freed", so the admission slot is freed too.
 * - Series rentals are skipped: which episode a series rental should download is
 *   undecided, so this module never guesses one.
 */
import type { DiscoveryTitle } from '../domain/content';
import { normalizeMemberState } from '../member/memberState';
import { resolveTitleMedia } from '../media/resolutionService';
import type { StreamCandidate } from '../media/types';
import { readMediaConfiguration } from '../platform/nativeBridge';
import {
  createTapeDownloadDriver,
  ensureTapeEngine,
  onTapeDownloadProgress,
  readTapeManifest,
  requestTapeEngine,
  writeTapeManifest,
  type TapeEngineResponse,
} from '../platform/tape';
import { admitTape } from './tapeAdmission';
import {
  MAX_TAPE_SOURCES,
  findTape,
  isFileIdx,
  isInfoHash,
  isTapeSize,
  removeTape,
  touchTape,
  upsertTape,
  type TapeManifest,
  type TapeRecord,
  type TapeState,
} from './tapeManifest';
import {
  createTapeQueue,
  type TapeDownloadProgress,
  type TapeFailureCode,
  type TapeJobSeed,
  type TapeQueue,
  type TapeQueueDriver,
  type TapeQueueEvent,
} from './tapeQueue';
import { readTapeSettings, type TapeSettings } from './tapeSettings';
import { createTapeHydration, type TapeHydration, type TapeHydrationResult } from './tapeHydration';
import { tapeDiagnostics, type TapeDiagnostics } from './tapeDiagnostics';

/** Native `SOURCE_BYTES`, private in `tapeManifest.ts`. */
const MAX_SOURCE_BYTES = 2_048;
/** Native `MAGNET_BYTES`, private in `tapeManifest.ts`. */
const MAX_MAGNET_BYTES = 8_192;
/** Native `FILE_NAME_BYTES`, private in `tapeManifest.ts`. */
const MAX_FILE_NAME_BYTES = 1_024;
/** Native `TITLE_BYTES`, private in `tapeManifest.ts`. */
const MAX_TITLE_BYTES = 512;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const textEncoder = new TextEncoder();

/** A typed reason, never a thrown string: callers can branch without parsing. */
export type RentalTapeCode =
  | 'tapes-disabled'
  | 'rental-unreadable'
  | 'series-out-of-scope'
  | 'title-unmapped'
  | 'no-qualifying-source'
  | 'not-a-torrent'
  | 'invalid-source'
  | 'unknown-file-index'
  | 'unknown-size'
  | 'already-queued'
  | 'cap-exceeded'
  | 'count-exceeded'
  | 'space-exceeded'
  | 'invalid-row'
  | 'manifest-write-failed'
  | 'media-failure'
  | 'queued';

/** `skipped` is a policy decision; `failed` is malformed data or a native rejection. */
export type RentalTapeOutcome = 'enqueued' | 'skipped' | 'failed';

export interface RentalTapeAttempt {
  rentalId: string | null;
  contentId: string | null;
  outcome: RentalTapeOutcome;
  code: RentalTapeCode;
  infoHash?: string;
}

export type RentalTapeRemoval = 'removed' | 'engine-unavailable' | 'remove-rejected';

export type RentalTapeRelease =
  | { status: 'absent' }
  | { status: 'released'; infoHash: string; removal: RentalTapeRemoval }
  | { status: 'failed'; code: 'manifest-write-failed' | 'media-failure' };

export interface RentalTapeProblem {
  code: RentalTapeCode;
  /** Bounded, redacted prose: never an infohash, tracker, magnet or path. */
  message: string;
}

/** Carry a closed failure code the queue's classifier understands. */
class RentalTapeError extends Error {
  readonly code: TapeFailureCode;

  constructor(code: TapeFailureCode, message: string) {
    super(message);
    this.name = 'RentalTapeError';
    this.code = code;
  }
}

export interface RentalTapeEngineResponse {
  status: number;
}

export interface RentalTapePipelineDependencies {
  /** Sampled on every rent: the master switch is a live setting. */
  settings: () => TapeSettings;
  readManifest: () => Promise<TapeManifest>;
  writeManifest: (manifest: TapeManifest) => Promise<void>;
  /**
   * The existing movie Quick Watch evaluator. The default runs
   * `resolveTitleMedia` (same normalizer, same version, same ladder); tests
   * inject the winner directly.
   */
  resolveWinner: (title: DiscoveryTitle) => Promise<StreamCandidate | null>;
  /** `tape_engine_ensure()`: lazily starts engine B and returns its origin. */
  ensureEngine: () => Promise<string>;
  /** `tape_engine_request(url, method, body)` through the allowlisted bridge. */
  requestEngine: (url: string, method: 'GET' | 'POST', body?: string | null) => Promise<RentalTapeEngineResponse>;
  /** `tape_download_start` / `tape_download_cancel`. */
  download: { start(infoHash: string, fileIdx: number): Promise<void>; cancel(): Promise<void> | void };
  /** `tape-download-progress` subscription, injected so tests need no shell. */
  subscribeProgress?: (listener: (progress: TapeDownloadProgress) => void) => void | (() => void);
  now?: () => string;
  onProblem?: (problem: RentalTapeProblem) => void;
  diagnostics?: Pick<TapeDiagnostics, 'record'>;
}

export interface RentalTapePipeline {
  /** The single runtime queue: one active download, FIFO by rent time. */
  queue: TapeQueue;
  enqueueRental(rental: unknown, titles: readonly DiscoveryTitle[]): Promise<RentalTapeAttempt[]>;
  /** A return cancels, removes and deletes the row. It never throws. */
  release(rentalId: string): Promise<RentalTapeRelease>;
  pump(): void;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).length;
}

/** Collapses whitespace, drops control characters and honours a byte ceiling. */
function boundedLabel(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  let result = '';
  for (const character of cleaned) {
    if (byteLength(result + character) > maxBytes) break;
    result += character;
  }
  return result.trim();
}

function boundedSources(candidate: StreamCandidate): string[] {
  if (candidate.playbackDescriptor.kind !== 'torrent') return [];
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const entry of candidate.playbackDescriptor.announce) {
    const source = boundedLabel(entry, MAX_SOURCE_BYTES);
    if (!source || seen.has(source)) continue;
    seen.add(source);
    sources.push(source);
    if (sources.length === MAX_TAPE_SOURCES) break;
  }
  return sources;
}

/** `magnet:?xt=urn:btih:<hash>` plus the trackers that still fit the native bound. */
export function tapeMagnet(infoHash: string, displayName: string, sources: readonly string[]): string {
  let magnet = `magnet:?xt=urn:btih:${infoHash}`;
  const name = boundedLabel(displayName, MAX_MAGNET_BYTES / 4);
  if (name) magnet += `&dn=${encodeURIComponent(name)}`;
  for (const source of sources) {
    const parameter = `&tr=${encodeURIComponent(source)}`;
    if (byteLength(magnet + parameter) > MAX_MAGNET_BYTES) break;
    magnet += parameter;
  }
  return magnet;
}

/**
 * The `/<hash>/create` body, mirroring `ensureTorrentStream`'s request exactly:
 * `torrent.infoHash`, `guessFileIdx: false` because the index is known here, and
 * `peerSearch.sources` only when trackers exist.
 */
export function tapeCreateBody(infoHash: string, sources: readonly string[]): string {
  const trackers = Array.from(new Set(sources
    .map((source) => source.trim())
    .filter((source) => source.length > 0)
    .map((source) => (source.startsWith('tracker:') || source.startsWith('dht:') ? source : `tracker:${source}`))));
  const body: Record<string, unknown> = {
    torrent: { infoHash },
    guessFileIdx: false,
  };
  if (trackers.length > 0) {
    body.peerSearch = { sources: [`dht:${infoHash}`, ...trackers], min: 40, max: 200 };
  }
  return JSON.stringify(body);
}

function createFailureCode(status: number): TapeFailureCode {
  if (status === 404) return 'torrent-not-found';
  if (status >= 400 && status < 500) return 'invalid-request';
  return 'read-failed';
}

interface RentalTapeItem {
  rentalId: string;
  contentId: string;
  tmdbId: number;
  title: string;
  type: 'movie' | 'series';
}

/**
 * Reads the confirmed rental the app just created. The API answers
 * `{ rental: { id, items: [...] } }`; the member normalizer already validates
 * that shape, so this reuses it instead of trusting a second reader.
 */
function rentalItems(rental: unknown): RentalTapeItem[] | null {
  const confirmed = typeof rental === 'object' && rental !== null && !Array.isArray(rental)
    ? (rental as { rental?: unknown }).rental
    : undefined;
  const active = normalizeMemberState({ activeRental: confirmed }).activeRental;
  if (!active) return null;
  return active.items.map((item) => ({
    rentalId: item.id,
    contentId: item.canonicalKey,
    tmdbId: item.tmdbId,
    title: item.name,
    type: item.type,
  }));
}

function titleFor(item: { contentId: string; tmdbId: number }, titles: readonly DiscoveryTitle[]): DiscoveryTitle | null {
  return titles.find((title) => title.identity.canonicalKey === item.contentId)
    ?? titles.find((title) => Number(title.identity.canonicalKey.split(':').at(-1)) === item.tmdbId) ?? null;
}

function tapeRecordFor(
  item: { rentalId: string; contentId: string; title: string },
  winner: StreamCandidate,
  addedAt: string,
): TapeRecord | null {
  if (winner.transportType !== 'torrent' || winner.playbackDescriptor.kind !== 'torrent') return null;
  const infoHash = winner.playbackDescriptor.infoHash.toLowerCase();
  const fileIdx = winner.playbackDescriptor.fileIndex;
  if (!isInfoHash(infoHash) || !isFileIdx(fileIdx)) return null;
  if (!isTapeSize(winner.sizeBytes)) return null;
  const title = boundedLabel(item.title, MAX_TITLE_BYTES);
  const fileName = boundedLabel(winner.displayName, MAX_FILE_NAME_BYTES) || title;
  if (!title || !fileName) return null;
  const sources = boundedSources(winner);
  return {
    rentalId: item.rentalId,
    contentId: item.contentId,
    title,
    infoHash,
    fileIdx,
    fileName,
    sizeBytes: winner.sizeBytes,
    descriptor: { sources, magnet: tapeMagnet(infoHash, winner.displayName || title, sources) },
    torrentBytesB64: null,
    state: 'queued',
    addedAt,
    completedAt: null,
    lastPlayedAt: null,
  };
}

type AdmissionCode = 'cap-exceeded' | 'count-exceeded' | 'unknown-size' | 'space-exceeded';
type DiagnosticAdmissionCode = Extract<AdmissionCode, 'cap-exceeded' | 'count-exceeded'>;

function admissionCode(reason: AdmissionCode): AdmissionCode {
  switch (reason) {
    case 'cap-exceeded': return 'cap-exceeded';
    case 'count-exceeded': return 'count-exceeded';
    case 'space-exceeded': return 'space-exceeded';
    default: return 'unknown-size';
  }
}

/** The live pipeline validates size first and has no free-space input yet. */
function diagnosticAdmissionCode(reason: AdmissionCode): DiagnosticAdmissionCode | null {
  return reason === 'cap-exceeded' || reason === 'count-exceeded' ? reason : null;
}

export function createRentalTapePipeline(dependencies: RentalTapePipelineDependencies): RentalTapePipeline {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const problem = (code: RentalTapeCode, message: string): void => {
    dependencies.onProblem?.({ code, message });
  };

  // Manifest state this pipeline last wrote, so a frequent progress event does
  // not turn into a frequent disk write.
  const persisted = new Map<string, TapeState>();

  /**
   * Every manifest mutation is a read-modify-write, so it is serialized: a
   * completed download, a return and a fresh rent can never interleave and
   * overwrite each other's rows.
   */
  let manifestChain: Promise<unknown> = Promise.resolve();
  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = manifestChain.then(task, task);
    manifestChain = run.catch(() => undefined);
    return run;
  }

  const queueDriver: TapeQueueDriver = {
    async start(infoHash: string, fileIdx: number): Promise<void> {
      // The descriptor lives in the row that admitted this tape (§8: re-create
      // from the stored descriptor, never from a second resolution).
      const manifest = await dependencies.readManifest();
      const tape = findTape(manifest, infoHash);
      if (!tape) throw new RentalTapeError('torrent-not-found', 'The rented tape has no stored descriptor.');
      const origin = await dependencies.ensureEngine();
      const response = await dependencies.requestEngine(
        `${origin}/${tape.infoHash}/create`,
        'POST',
        tapeCreateBody(tape.infoHash, tape.descriptor.sources),
      );
      if (response.status < 200 || response.status >= 300) {
        throw new RentalTapeError(createFailureCode(response.status), 'The tape engine refused to create the torrent.');
      }
      await dependencies.download.start(infoHash, fileIdx);
    },
    cancel: () => dependencies.download.cancel(),
  };

  const queue = createTapeQueue({
    driver: queueDriver,
    enabled: dependencies.settings().enabled,
    now,
    onEvent: (event) => { handleQueueEvent(event); },
  });

  dependencies.subscribeProgress?.((progress) => { queue.onProgress(progress); });

  function pump(): void {
    // One active download, FIFO: a single explicit start is all the queue needs.
    if (queue.isPaused()) return;
    queue.startNext();
  }

  async function persist(infoHash: string, state: TapeState, completedAt?: string): Promise<void> {
    if (persisted.get(infoHash) === state) return;
    await serialized(async () => {
      try {
        const manifest = await dependencies.readManifest();
        const row = findTape(manifest, infoHash);
        if (!row) return;
        if (row.state === state && (completedAt === undefined || row.completedAt !== null)) {
          persisted.set(infoHash, state);
          return;
        }
        const next = touchTape(manifest, infoHash, { state, ...(completedAt ? { completedAt } : {}) });
        if (!next) {
          problem('invalid-row', 'A tape row could not move to its new state.');
          return;
        }
        await dependencies.writeManifest(next);
        persisted.set(infoHash, state);
      } catch {
        problem('manifest-write-failed', 'A tape row could not be saved.');
      }
    });
  }

  function handleQueueEvent(event: TapeQueueEvent): void {
    const infoHash = event.job.infoHash;
    switch (event.type) {
      case 'started':
        void persist(infoHash, 'resolving');
        return;
      case 'progress':
        void persist(infoHash, 'downloading');
        return;
      case 'completed':
        void persist(infoHash, 'ready', now()).then(pump, pump);
        return;
      case 'failed':
        void persist(infoHash, event.job.state === 'unverified' ? 'unverified' : 'failed').then(pump, pump);
        return;
      case 'retry-queued':
        void persist(infoHash, 'queued').then(pump, pump);
        return;
      case 'paused':
        // Playback priority (§2.1): the P4 window resumes and pumps later.
        void persist(infoHash, 'queued');
        return;
      case 'cancelled':
        // The return path owns the row; the slot is free for the next tape.
        pump();
        return;
    }
  }

  async function enqueueRental(
    rental: unknown,
    titles: readonly DiscoveryTitle[],
  ): Promise<RentalTapeAttempt[]> {
    const attempts: RentalTapeAttempt[] = [];
    try {
      // The master switch is checked before any manifest read, engine start or
      // download, so "off" costs nothing and starts nothing.
      if (!dependencies.settings().enabled) {
        return [{ rentalId: null, contentId: null, outcome: 'skipped', code: 'tapes-disabled' }];
      }

      const items = rentalItems(rental);
      if (!items) {
        return [{ rentalId: null, contentId: null, outcome: 'skipped', code: 'rental-unreadable' }];
      }

      for (const item of items) {
        const base = { rentalId: item.rentalId, contentId: item.contentId };
        // Series rentals are deliberately out of scope: which episode a series
        // rental should download is undecided, so nothing is guessed here.
        if (item.type === 'series') {
          attempts.push({ ...base, outcome: 'skipped', code: 'series-out-of-scope' });
          continue;
        }
        const title = titleFor(item, titles);
        if (!title) {
          attempts.push({ ...base, outcome: 'skipped', code: 'title-unmapped' });
          continue;
        }

        // One candidate, chosen by the shipped evaluator. No second chooser.
        let winner: StreamCandidate | null;
        try {
          winner = await dependencies.resolveWinner(title);
        } catch {
          attempts.push({ ...base, outcome: 'failed', code: 'media-failure' });
          continue;
        }
        if (!winner) {
          attempts.push({ ...base, outcome: 'skipped', code: 'no-qualifying-source' });
          continue;
        }
        if (winner.transportType !== 'torrent' || winner.playbackDescriptor.kind !== 'torrent') {
          attempts.push({ ...base, outcome: 'skipped', code: 'not-a-torrent' });
          continue;
        }
        if (!isInfoHash(winner.playbackDescriptor.infoHash.toLowerCase())) {
          attempts.push({ ...base, outcome: 'failed', code: 'invalid-source' });
          continue;
        }
        if (!isFileIdx(winner.playbackDescriptor.fileIndex)) {
          attempts.push({ ...base, outcome: 'skipped', code: 'unknown-file-index' });
          continue;
        }
        if (!isTapeSize(winner.sizeBytes)) {
          attempts.push({ ...base, outcome: 'failed', code: 'unknown-size' });
          continue;
        }
        const sizeBytes = winner.sizeBytes;

        const infoHash = winner.playbackDescriptor.infoHash.toLowerCase();
        const selected = winner;
        dependencies.diagnostics?.record({
          event: 'enqueue',
          contentId: item.contentId,
          sizeBytes,
          infoHash,
        });
        // Admission and the row write share one mutation so two rentals cannot
        // both pass the ceiling against the same manifest snapshot.
        const plan = await serialized(async (): Promise<{
          outcome: RentalTapeOutcome;
          code: RentalTapeCode;
          row: TapeRecord | null;
        }> => {
          let manifest: TapeManifest;
          try {
            manifest = await dependencies.readManifest();
          } catch {
            return { outcome: 'failed', code: 'manifest-write-failed', row: null };
          }
          if (findTape(manifest, infoHash)) {
            return { outcome: 'skipped', code: 'already-queued', row: null };
          }

          // Admission before any work. `freeBytes` stays unknown until a native
          // `statvfs` command exists; `maxCount` is absent from the persisted
          // settings (P4 note), so admission follows its documented
          // rental-limit default and the store's own ten-row ceiling.
          const admitted = admitTape({
            sizeBytes,
            tapes: manifest.tapes,
            caps: { maxGb: dependencies.settings().maxGb },
            freeBytes: null,
          });
          if (!admitted.allowed) {
            const diagnosticReason = diagnosticAdmissionCode(admitted.reason);
            if (diagnosticReason) {
              dependencies.diagnostics?.record({
                event: 'admit-refused',
                contentId: item.contentId,
                infoHash,
                reason: diagnosticReason,
              });
            }
            return { outcome: 'skipped', code: admissionCode(admitted.reason), row: null };
          }

          const row = tapeRecordFor(item, selected, now());
          const next = row ? upsertTape(manifest, row) : null;
          if (!row || !next) return { outcome: 'failed', code: 'invalid-row', row: null };
          try {
            await dependencies.writeManifest(next);
          } catch {
            return { outcome: 'failed', code: 'manifest-write-failed', row: null };
          }
          return { outcome: 'enqueued', code: 'queued', row };
        });

        if (!plan.row) {
          attempts.push({ ...base, outcome: plan.outcome, code: plan.code, infoHash });
          continue;
        }
        persisted.set(plan.row.infoHash, 'queued');

        const seed: TapeJobSeed = {
          infoHash: plan.row.infoHash,
          fileIdx: plan.row.fileIdx,
          rentalId: plan.row.rentalId,
          sizeBytes: plan.row.sizeBytes,
          addedAt: plan.row.addedAt,
        };
        if (!queue.enqueue(seed)) {
          attempts.push({ ...base, outcome: 'failed', code: 'invalid-row', infoHash: plan.row.infoHash });
          continue;
        }
        attempts.push({ ...base, outcome: 'enqueued', code: 'queued', infoHash: plan.row.infoHash });
      }
    } catch {
      problem('media-failure', 'The rented tape pipeline failed unexpectedly.');
      attempts.push({ rentalId: null, contentId: null, outcome: 'failed', code: 'media-failure' });
    }

    // One pump for the whole batch: the queue keeps FIFO order and one active.
    pump();
    return attempts;
  }

  async function release(rentalId: string): Promise<RentalTapeRelease> {
    try {
      return await serialized(async (): Promise<RentalTapeRelease> => {
        const manifest = await dependencies.readManifest();
        const tape = manifest.tapes.find((row) => row.rentalId === rentalId);
        if (!tape) return { status: 'absent' };

        // Stop the drain first so nothing keeps writing into a directory we are
        // about to remove. The queue ignores the cancelled drain's late rejection.
        queue.cancelForReturn(tape.infoHash);

        let removal: RentalTapeRemoval = 'removed';
        try {
          const origin = await dependencies.ensureEngine();
          const response = await dependencies.requestEngine(`${origin}/${tape.infoHash}/remove`, 'GET');
          if (response.status < 200 || response.status >= 300) removal = 'remove-rejected';
        } catch {
          // A media-side failure is a typed reason, never a failed user return.
          removal = 'engine-unavailable';
        }
        if (removal !== 'removed') problem('media-failure', 'The tape engine could not remove the returned tape.');
        dependencies.diagnostics?.record({
          event: 'return',
          infoHash: tape.infoHash,
          removeStatus: removal,
        });

        // §8: the manifest row is deleted, which also frees the admission slot.
        await dependencies.writeManifest(removeTape(manifest, tape.infoHash));
        persisted.delete(tape.infoHash);
        pump();
        return { status: 'released', infoHash: tape.infoHash, removal };
      });
    } catch {
      // Even a manifest failure must not surface as a rental error.
      return { status: 'failed', code: 'manifest-write-failed' };
    }
  }

  return { queue, enqueueRental, release, pump };
}

/** The shipped evaluator: same normalizer, same version, same movie ladder. */
async function resolveMovieWinner(title: DiscoveryTitle): Promise<StreamCandidate | null> {
  const resolution = await resolveTitleMedia(title, await readMediaConfiguration());
  return resolution.quickWatch?.winner ?? null;
}

let runtime: RentalTapePipeline | null = null;

/** Lazily built so importing the module never reads settings or a manifest. */
export function rentalTapePipeline(): RentalTapePipeline {
  runtime ??= createRentalTapePipeline({
    settings: readTapeSettings,
    readManifest: readTapeManifest,
    writeManifest: writeTapeManifest,
    resolveWinner: resolveMovieWinner,
    ensureEngine: () => ensureTapeEngine(readTapeSettings()),
    requestEngine: (url, method, body): Promise<TapeEngineResponse> => requestTapeEngine(url, method, body),
    download: createTapeDownloadDriver(),
    subscribeProgress: (listener) => {
      void onTapeDownloadProgress(listener).catch(() => undefined);
    },
    diagnostics: tapeDiagnostics(),
  });
  return runtime;
}

/** The one runtime queue; P4's playback window pauses and resumes this instance. */
export function rentalTapeQueue(): TapeQueue {
  return rentalTapePipeline().queue;
}

/** Called when the app may use the network again (a RAM playback ended). */
export function pumpRentalTapes(): void {
  rentalTapePipeline().pump();
}

/**
 * The single rental-success hook. Fire-and-forget: the tape pipeline must never
 * delay, fail or otherwise change the user's rental.
 */
export function offerConfirmedRentalToTapes(rental: unknown, titles: readonly DiscoveryTitle[]): void {
  void rentalTapePipeline().enqueueRental(rental, titles).catch(() => undefined);
}

/** The single return hook. Also fire-and-forget, for the same reason. */
export function releaseReturnedTape(rentalId: string): void {
  void rentalTapePipeline().release(rentalId).catch(() => undefined);
}

let hydration: TapeHydration | null = null;

/**
 * P8: the once-per-session startup hydration (§8 restart, §9 retry-once).
 *
 * Called after the app is ready. Fire-and-forget and silent: it never throws,
 * blocks a render or shows an error, and with an empty manifest or the master
 * switch off it starts no engine, reads no row list and builds no queue. The
 * queue is reached lazily through the singleton, so a session whose tapes are
 * all `ready` never constructs it (and never subscribes to native progress).
 */
export function hydrateRetainedTapes(): Promise<TapeHydrationResult> {
  hydration ??= createTapeHydration({
    settings: readTapeSettings,
    readManifest: readTapeManifest,
    writeManifest: writeTapeManifest,
    ensureEngine: () => ensureTapeEngine(readTapeSettings()),
    requestEngine: (url, method, body): Promise<TapeEngineResponse> => requestTapeEngine(url, method, body),
    createBody: tapeCreateBody,
    queue: { enqueue: (seed) => rentalTapePipeline().queue.enqueue(seed) },
    pump: pumpRentalTapes,
    onProblem: (problem) => {
      // Exactly one channel: typed JSONL when enabled, the existing warning otherwise.
      tapeDiagnostics().reportProblem(problem.code, problem.message);
    },
    diagnostics: tapeDiagnostics(),
  });
  return hydration.hydrate();
}
