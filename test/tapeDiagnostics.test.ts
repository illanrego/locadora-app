import { describe, expect, it, vi } from 'vitest';
import {
  TAPE_DIAGNOSTIC_EVENT_EMITTERS,
  TAPE_DIAGNOSTIC_REASON_EMITTERS,
  createTapeDiagnostics,
  type TapeDiagnosticEvent,
} from '../src/rentals/tapeDiagnostics';

describe('rented-tape diagnostics flag boundary', () => {
  it('does not append any offered event when the native exact-value flag is off', async () => {
    const append = vi.fn<(event: TapeDiagnosticEvent) => Promise<void>>();
    const enabled = vi.fn(async () => false);
    const diagnostics = createTapeDiagnostics({ enabled, append });

    diagnostics.record({
      event: 'enqueue',
      contentId: 'movie:7',
      sizeBytes: 734_003_200,
      infoHash: 'a'.repeat(40),
    });
    diagnostics.record({ event: 'pause', cause: 'ram-playback' });
    await diagnostics.flush();

    expect(enabled).toHaveBeenCalledTimes(1);
    expect(append).not.toHaveBeenCalled();
  });

  it('appends enabled events serially without adding fields', async () => {
    const written: TapeDiagnosticEvent[] = [];
    const diagnostics = createTapeDiagnostics({
      enabled: async () => true,
      append: async (event) => { written.push(event); },
    });
    const events: TapeDiagnosticEvent[] = [
      { event: 'enqueue', contentId: 'movie:7', sizeBytes: 734_003_200, infoHash: 'a'.repeat(40) },
      { event: 'admit-refused', contentId: 'movie:8', reason: 'cap-exceeded' },
      { event: 'hydration', registered: 1, requeued: 2, unverified: 3, refused: 4 },
    ];
    for (const event of events) diagnostics.record(event);
    await diagnostics.flush();

    expect(written).toEqual(events);
  });

  it('documents and constructs every event variant in the emitter audit', async () => {
    const hash = 'a'.repeat(40);
    const events: TapeDiagnosticEvent[] = [
      { event: 'enqueue', contentId: 'movie:7', sizeBytes: 1, infoHash: hash },
      { event: 'admit-refused', contentId: 'movie:7', infoHash: hash, reason: 'count-exceeded' },
      { event: 'ensure' },
      { event: 'create', infoHash: hash, httpStatus: 200 },
      { event: 'download-start', infoHash: hash },
      { event: 'download-complete', infoHash: hash, state: 'ready' },
      { event: 'seed-observed', infoHash: hash, state: 'seeding' },
      { event: 'download-failed', infoHash: hash, reason: 'read-failed' },
      { event: 'pause', cause: 'ram-playback' },
      { event: 'resume', cause: 'idle' },
      { event: 'return', infoHash: hash, removeStatus: 'removed' },
      { event: 'hydration', registered: 1, requeued: 2, unverified: 3, refused: 4 },
      {
        event: 'hydrate-summary',
        stateCounts: { queued: 1, resolving: 0, downloading: 0, ready: 0, seeding: 0, failed: 0, returned: 0, unverified: 0 },
      },
      { event: 'problem', reason: 'manifest-unreadable' },
    ];
    const written: TapeDiagnosticEvent[] = [];
    const diagnostics = createTapeDiagnostics({
      enabled: async () => true,
      append: async (event) => { written.push(event); },
    });
    for (const event of events) diagnostics.record(event);
    await diagnostics.flush();

    expect(events.map(({ event }) => event).sort()).toEqual(Object.keys(TAPE_DIAGNOSTIC_EVENT_EMITTERS).sort());
    expect(Object.keys(TAPE_DIAGNOSTIC_REASON_EMITTERS).sort()).toEqual([
      'cancelled',
      'cap-exceeded',
      'count-exceeded',
      'engine-unavailable',
      'invalid-request',
      'invalid-row',
      'manifest-unreadable',
      'manifest-write-failed',
      'read-failed',
      'registration-refused',
      'too-large',
      'torrent-not-found',
    ]);
    expect(written).toEqual(events);
  });

  it('records a problem only in JSONL when enabled and warns only when disabled', async () => {
    const enabledAppend = vi.fn<(event: TapeDiagnosticEvent) => Promise<void>>(async () => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const enabled = createTapeDiagnostics({ enabled: async () => true, append: enabledAppend });
    enabled.reportProblem('registration-refused', 'The tape engine refused to re-attach a retained tape.');
    await enabled.flush();
    expect(enabledAppend).toHaveBeenCalledWith({ event: 'problem', reason: 'registration-refused' });
    expect(warn).not.toHaveBeenCalled();

    const disabledAppend = vi.fn<(event: TapeDiagnosticEvent) => Promise<void>>(async () => undefined);
    const disabled = createTapeDiagnostics({ enabled: async () => false, append: disabledAppend });
    disabled.reportProblem('registration-refused', 'The tape engine refused to re-attach a retained tape.');
    await disabled.flush();
    expect(disabledAppend).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[locadora] tapes: The tape engine refused to re-attach a retained tape.',
    );
    warn.mockRestore();
  });
});
