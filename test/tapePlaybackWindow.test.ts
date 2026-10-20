import { describe, expect, it, vi } from 'vitest';
import { createTapePlaybackWindow, isFinishedTapeLoad } from '../src/rentals/tapePlaybackWindow';

const HASH = 'a'.repeat(40);
const TAPE = `http://127.0.0.1:11472/${HASH}/3`;
const RAM = `http://127.0.0.1:11471/${HASH}/3`;

function fixture(running = true) {
  const queue = { pause: vi.fn(), resume: vi.fn() };
  const engineRunning = vi.fn(async () => running);
  const postSeedingEnabled = vi.fn(async () => true);
  const record = vi.fn();
  return {
    queue,
    engineRunning,
    postSeedingEnabled,
    record,
    window: createTapePlaybackWindow({ queue, engineRunning, postSeedingEnabled, diagnostics: { record } }),
  };
}

describe('rented-tape seeding window', () => {
  it('recognizes only a finished tape copy as the local path', () => {
    expect(isFinishedTapeLoad(TAPE)).toBe(true);
    for (const descriptor of [
      RAM,
      `http://localhost:11472/${HASH}/3`,
      `http://127.0.0.1:11472/${HASH}/3?x=1`,
      `http://127.0.0.1:11472/${HASH}/settings`,
      `http://127.0.0.1:11472/${HASH}/../${HASH}/3`,
      'https://media.example.invalid/video',
      'not a URL',
    ]) expect(isFinishedTapeLoad(descriptor)).toBe(false);
  });

  it.each([
    ['ends', (window: ReturnType<typeof createTapePlaybackWindow>) => window.playbackEnded()],
    ['closes', (window: ReturnType<typeof createTapePlaybackWindow>) => window.playbackClosed()],
    ['errors', (window: ReturnType<typeof createTapePlaybackWindow>) => window.playbackErrored()],
  ])('posts false once for RAM playback and true once when it %s', async (_label, finish) => {
    const state = fixture();
    await state.window.playbackStarted(RAM);
    await state.window.playbackStarted(RAM);
    await finish(state.window);
    await finish(state.window);

    expect(state.postSeedingEnabled.mock.calls).toEqual([[false], [true]]);
    expect(state.queue.pause).toHaveBeenCalledTimes(1);
    expect(state.queue.resume).toHaveBeenCalledTimes(1);
    expect(state.record.mock.calls).toEqual([
      [{ event: 'pause', cause: 'ram-playback' }],
      [{ event: 'resume', cause: 'idle' }],
    ]);
  });

  it('keeps seeding and the queue running for a finished tape', async () => {
    const state = fixture();
    await state.window.playbackStarted(TAPE);
    await state.window.playbackEnded();
    expect(state.postSeedingEnabled).not.toHaveBeenCalled();
    expect(state.queue.pause).not.toHaveBeenCalled();
    expect(state.queue.resume).toHaveBeenCalledTimes(2);
  });

  it('does not POST when the tape engine is not running', async () => {
    const state = fixture(false);
    await state.window.playbackStarted(RAM);
    await state.window.playbackEnded();
    expect(state.engineRunning).toHaveBeenCalledTimes(1);
    expect(state.postSeedingEnabled).not.toHaveBeenCalled();
  });
});
