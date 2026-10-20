/**
 * P9: the tiny typed frontend for opt-in rented-tape diagnostics.
 *
 * The native side owns the exact environment check, private file, 2 MiB cap,
 * timestamp and redaction. This module only serializes the closed event union.
 * Disabled diagnostics perform one lazy flag read per session and never invoke
 * the append command.
 */
import { invoke } from '@tauri-apps/api/core';
import { isNativeShell } from '../platform/nativeBridge';
import type { TapeState } from './tapeManifest';
import type { RentalTapeRemoval } from './rentalTapePipeline';
import type { TapeFailureCode } from './tapeQueue';

/** Reasons that a real diagnostics emitter can produce today. */
export type TapeDiagnosticReason =
  | TapeFailureCode
  | 'cap-exceeded'
  | 'count-exceeded'
  | 'invalid-row'
  | 'manifest-write-failed'
  | 'engine-unavailable'
  | 'registration-refused'
  | 'manifest-unreadable';

export type TapeDiagnosticProblemReason = Extract<
  TapeDiagnosticReason,
  | 'invalid-row'
  | 'manifest-write-failed'
  | 'engine-unavailable'
  | 'registration-refused'
  | 'manifest-unreadable'
>;

export interface TapeDiagnosticStateCounts {
  queued: number;
  resolving: number;
  downloading: number;
  ready: number;
  seeding: number;
  failed: number;
  returned: number;
  unverified: number;
}

export type TapeDiagnosticEvent =
  | { event: 'enqueue'; contentId: string; sizeBytes: number; infoHash?: string }
  | { event: 'admit-refused'; contentId?: string; infoHash?: string; reason: TapeDiagnosticReason }
  | { event: 'ensure'; infoHash?: string }
  | { event: 'create'; infoHash: string; httpStatus: number }
  | { event: 'download-start'; infoHash: string }
  | { event: 'download-complete'; infoHash: string; state: TapeState }
  | { event: 'seed-observed'; infoHash: string; state: 'seeding' }
  | { event: 'download-failed'; infoHash: string; reason: TapeFailureCode }
  | { event: 'pause' | 'resume'; cause: 'ram-playback' | 'idle' }
  | { event: 'return'; infoHash: string; removeStatus: RentalTapeRemoval }
  | { event: 'hydration'; registered: number; requeued: number; unverified: number; refused: number }
  | { event: 'hydrate-summary'; stateCounts: TapeDiagnosticStateCounts }
  | { event: 'problem'; reason: TapeDiagnosticProblemReason };

/** Compile-time audit: adding an event variant requires naming its real emitter. */
export const TAPE_DIAGNOSTIC_EVENT_EMITTERS = {
  enqueue: 'rentalTapePipeline enqueueRental',
  'admit-refused': 'rentalTapePipeline admission refusal',
  ensure: 'streaming_engine tape_engine_ensure success',
  create: 'streaming_engine tape_engine_request create response',
  'download-start': 'tape_download accepted native drain',
  'download-complete': 'tape_download successful native drain',
  'seed-observed': 'TapeDashboard derived sharing reading',
  'download-failed': 'tape_download failed native drain',
  pause: 'tapePlaybackWindow RAM playback entry',
  resume: 'tapePlaybackWindow RAM playback exit',
  return: 'rentalTapePipeline release',
  hydration: 'tapeHydration result',
  'hydrate-summary': 'tapeHydration manifest read',
  problem: 'rentalTapePipeline hydration onProblem route',
} as const satisfies Record<TapeDiagnosticEvent['event'], string>;

/** Compile-time reason audit: every accepted code names a reachable branch. */
export const TAPE_DIAGNOSTIC_REASON_EMITTERS = {
  'cap-exceeded': 'admitTape configured ceiling',
  'count-exceeded': 'admitTape ten-row ceiling',
  'invalid-row': 'tapeHydration touch or enqueue refusal',
  'manifest-write-failed': 'tapeHydration manifest write rejection',
  'engine-unavailable': 'tapeHydration engine start or registration bridge failure',
  'registration-refused': 'tapeHydration non-metainfo create refusal',
  'manifest-unreadable': 'tapeHydration manifest read rejection',
  'torrent-not-found': 'tape_download HTTP 404',
  'invalid-request': 'tape_download invalid command or occupied drain slot',
  'read-failed': 'tape_download response or body read failure',
  'too-large': 'tape_download body above 16 GiB',
  cancelled: 'tape_download cancellation channel',
} as const satisfies Record<TapeDiagnosticReason, string>;

export interface TapeDiagnostics {
  record(event: TapeDiagnosticEvent): void;
  /** Writes the typed event when enabled; otherwise preserves the old warning. */
  reportProblem(reason: TapeDiagnosticProblemReason, message: string): void;
  /** Test/closeout hook: resolves after every event already offered. */
  flush(): Promise<void>;
}

interface TapeDiagnosticsDependencies {
  enabled: () => Promise<boolean>;
  append: (event: TapeDiagnosticEvent) => Promise<void>;
}

export function createTapeDiagnostics(dependencies: TapeDiagnosticsDependencies): TapeDiagnostics {
  let enabled: Promise<boolean> | null = null;
  let chain: Promise<void> = Promise.resolve();
  const enabledOnce = (): Promise<boolean> => {
    enabled ??= dependencies.enabled().catch(() => false);
    return enabled;
  };
  return {
    record(event): void {
      chain = chain.then(async () => {
        if (await enabledOnce()) await dependencies.append(event);
      }).catch(() => undefined);
    },
    reportProblem(reason, message): void {
      chain = chain.then(async () => {
        if (await enabledOnce()) {
          await dependencies.append({ event: 'problem', reason });
        } else {
          console.warn(`[locadora] tapes: ${message}`);
        }
      }).catch(() => undefined);
    },
    flush(): Promise<void> {
      return chain;
    },
  };
}

let runtime: TapeDiagnostics | null = null;

export function tapeDiagnostics(): TapeDiagnostics {
  runtime ??= createTapeDiagnostics({
    enabled: async () => isNativeShell()
      && await invoke<boolean>('tape_diagnostics_enabled') === true,
    append: (event) => invoke<void>('tape_diagnostics_append', { event }),
  });
  return runtime;
}
