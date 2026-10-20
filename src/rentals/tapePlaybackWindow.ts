/**
 * P4 playback-priority state machine.
 *
 * Browsing, idle time and a finished tape keep engine B seeding. A load that is
 * not the strict tape-copy URL is the RAM path: seeding is disabled and the
 * queue is paused until that playback ends, closes or errors. The coordinator
 * never starts either engine and deliberately swallows an unavailable B.
 *
 * P5 owns the one runtime queue (rental → tape wiring); this window pauses and
 * resumes that instance, so a RAM stream also holds back rented-tape downloads.
 */
import { isTapeEngineRunning, setTapeSeedingEnabled } from '../platform/tape';
import { pumpRentalTapes, rentalTapeQueue } from './rentalTapePipeline';
import type { TapeQueue } from './tapeQueue';
import { tapeDiagnostics, type TapeDiagnostics } from './tapeDiagnostics';

const TAPE_COPY_LOAD = /^http:\/\/127\.0\.0\.1:11472\/[0-9a-f]{40}\/\d{1,4}$/;

export function isFinishedTapeLoad(descriptor: string): boolean {
  // Match the raw spelling before URL normalization, mirroring the native B
  // player policy. Dot segments and alternate loopback spellings are RAM-path
  // loads for scheduling purposes even though URL would normalize some of them.
  return TAPE_COPY_LOAD.test(descriptor);
}

type PlaybackState = 'idle' | 'tape' | 'ram';

export interface TapePlaybackWindowDependencies {
  queue: Pick<TapeQueue, 'pause' | 'resume'>;
  engineRunning: () => Promise<boolean>;
  postSeedingEnabled: (enabled: boolean) => Promise<boolean | void>;
  /**
   * Called when a RAM stream ends and the app may use the network again. The
   * queue itself still never auto-starts; the app's scheduler decides.
   */
  onNetworkAvailable?: () => void;
  diagnostics?: Pick<TapeDiagnostics, 'record'>;
}

export interface TapePlaybackWindow {
  playbackStarted(descriptor: string): Promise<void>;
  playbackEnded(): Promise<void>;
  playbackClosed(): Promise<void>;
  playbackErrored(): Promise<void>;
}

class PlaybackWindow implements TapePlaybackWindow {
  private state: PlaybackState = 'idle';
  /** Engine B starts with seeding enabled, so no opening POST is needed. */
  private appliedSeeding = true;
  private settingsChain: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: TapePlaybackWindowDependencies) {}

  playbackStarted(descriptor: string): Promise<void> {
    return this.transition(isFinishedTapeLoad(descriptor) ? 'tape' : 'ram');
  }

  playbackEnded(): Promise<void> {
    return this.transition('idle');
  }

  playbackClosed(): Promise<void> {
    return this.transition('idle');
  }

  playbackErrored(): Promise<void> {
    return this.transition('idle');
  }

  private transition(next: PlaybackState): Promise<void> {
    if (this.state === next) return this.settingsChain;
    const previous = this.state;
    this.state = next;
    const seedingEnabled = next !== 'ram';
    if (seedingEnabled) {
      this.dependencies.queue.resume();
      this.dependencies.onNetworkAvailable?.();
      if (previous === 'ram') {
        this.dependencies.diagnostics?.record({ event: 'resume', cause: 'idle' });
      }
    } else {
      this.dependencies.queue.pause();
      this.dependencies.diagnostics?.record({ event: 'pause', cause: 'ram-playback' });
    }

    this.settingsChain = this.settingsChain.then(async () => {
      if (this.appliedSeeding === seedingEnabled) return;
      try {
        if (!await this.dependencies.engineRunning()) return;
        const applied = await this.dependencies.postSeedingEnabled(seedingEnabled);
        if (applied !== false) this.appliedSeeding = seedingEnabled;
      } catch {
        // Engine B may stop between readiness and POST. Off already means no seeding.
      }
    });
    return this.settingsChain;
  }
}

export function createTapePlaybackWindow(
  dependencies: TapePlaybackWindowDependencies,
): TapePlaybackWindow {
  return new PlaybackWindow(dependencies);
}

const runtimeQueue = rentalTapeQueue();
const runtimeWindow = createTapePlaybackWindow({
  queue: runtimeQueue,
  engineRunning: isTapeEngineRunning,
  postSeedingEnabled: setTapeSeedingEnabled,
  onNetworkAvailable: pumpRentalTapes,
  diagnostics: tapeDiagnostics(),
});

export function notifyTapePlaybackStarted(descriptor: string): void {
  void runtimeWindow.playbackStarted(descriptor);
}

export function notifyTapePlaybackEnded(): void {
  void runtimeWindow.playbackEnded();
}

export function notifyTapePlaybackClosed(): void {
  void runtimeWindow.playbackClosed();
}

export function notifyTapePlaybackErrored(): void {
  void runtimeWindow.playbackErrored();
}
