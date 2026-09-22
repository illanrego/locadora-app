import { describe, expect, it } from 'vitest';
import { INITIAL_PLAYER_STATE, reducePlayerState } from '../src/media/playerMachine';

describe('player state machine', () => {
  it('follows the complete successful resolution and playback sequence', () => {
    let state = reducePlayerState(INITIAL_PLAYER_STATE, { type: 'SELECT_TITLE', titleKey: 'movie:tmdb:1' });
    expect(state.phase).toBe('resolving-identity');
    state = reducePlayerState(state, { type: 'IDENTITY_RESOLVED' });
    state = reducePlayerState(state, { type: 'STREAMS_LOADED' });
    state = reducePlayerState(state, { type: 'CANDIDATES_NORMALIZED' });
    state = reducePlayerState(state, { type: 'SOURCE_SELECTED', candidateId: 'candidate-1' });
    expect(state.phase).toBe('buffering');
    state = reducePlayerState(state, { type: 'FILE_LOADED' });
    state = reducePlayerState(state, { type: 'POSITION', seconds: 12.5 });
    state = reducePlayerState(state, { type: 'DURATION', seconds: 90 });
    expect(state).toMatchObject({ phase: 'playing', positionSeconds: 12.5, durationSeconds: 90 });
    state = reducePlayerState(state, { type: 'PAUSED' });
    expect(state.phase).toBe('paused');
    state = reducePlayerState(state, { type: 'PLAYING' });
    state = reducePlayerState(state, { type: 'ENDED' });
    expect(state.phase).toBe('ended');
  });

  it('ignores out-of-order transitions and bounds diagnostics', () => {
    expect(reducePlayerState(INITIAL_PLAYER_STATE, { type: 'FILE_LOADED' })).toEqual(INITIAL_PLAYER_STATE);
    let state = reducePlayerState(INITIAL_PLAYER_STATE, { type: 'SELECT_TITLE', titleKey: 'movie:tmdb:1' });
    state = reducePlayerState(state, { type: 'FAILED', message: 'x'.repeat(400) });
    expect(state.phase).toBe('failed');
    expect(state.error).toHaveLength(240);
  });

  it('cancels without mutating any Locadora domain state', () => {
    const resolving = reducePlayerState(INITIAL_PLAYER_STATE, { type: 'SELECT_TITLE', titleKey: 'series:tmdb:2' });
    expect(reducePlayerState(resolving, { type: 'CANCEL' })).toEqual(INITIAL_PLAYER_STATE);
  });
});
