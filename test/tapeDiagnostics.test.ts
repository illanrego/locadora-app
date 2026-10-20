import { describe, expect, it, vi } from 'vitest';
import { createTapeDiagnostics, type TapeDiagnosticEvent } from '../src/rentals/tapeDiagnostics';

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
});
