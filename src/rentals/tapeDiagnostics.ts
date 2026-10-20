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
import type { RentalTapeCode, RentalTapeRemoval } from './rentalTapePipeline';
import type { TapeFailureCode } from './tapeQueue';

export type TapeDiagnosticReason = Exclude<RentalTapeCode, 'queued'> | TapeFailureCode
  | 'registration-refused' | 'manifest-unreadable';

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
  | { event: 'hydrate-summary'; stateCounts: TapeDiagnosticStateCounts };

export interface TapeDiagnostics {
  record(event: TapeDiagnosticEvent): void;
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
  return {
    record(event): void {
      enabled ??= dependencies.enabled().catch(() => false);
      chain = chain.then(async () => {
        if (await enabled) await dependencies.append(event);
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
