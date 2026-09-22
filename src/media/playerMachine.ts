export type PlayerPhase =
  | 'idle'
  | 'resolving-identity'
  | 'loading-streams'
  | 'normalizing-candidates'
  | 'applying-quick-watch'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'failed';

export interface PlayerMachineState {
  phase: PlayerPhase;
  titleKey: string | null;
  candidateId: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  error: string | null;
}

export type PlayerMachineEvent =
  | { type: 'SELECT_TITLE'; titleKey: string }
  | { type: 'IDENTITY_RESOLVED' }
  | { type: 'STREAMS_LOADED' }
  | { type: 'CANDIDATES_NORMALIZED' }
  | { type: 'SOURCE_SELECTED'; candidateId: string }
  | { type: 'FILE_LOADED' }
  | { type: 'PLAYING' }
  | { type: 'PAUSED' }
  | { type: 'POSITION'; seconds: number }
  | { type: 'DURATION'; seconds: number }
  | { type: 'ENDED' }
  | { type: 'FAILED'; message: string }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

export const INITIAL_PLAYER_STATE: PlayerMachineState = {
  phase: 'idle',
  titleKey: null,
  candidateId: null,
  positionSeconds: 0,
  durationSeconds: null,
  error: null,
};

const allowedTransitions: Record<PlayerPhase, PlayerPhase[]> = {
  idle: ['resolving-identity'],
  'resolving-identity': ['loading-streams', 'failed', 'idle'],
  'loading-streams': ['normalizing-candidates', 'failed', 'idle'],
  'normalizing-candidates': ['applying-quick-watch', 'failed', 'idle'],
  'applying-quick-watch': ['buffering', 'failed', 'idle'],
  buffering: ['playing', 'paused', 'failed', 'idle'],
  playing: ['paused', 'ended', 'failed', 'idle'],
  paused: ['playing', 'ended', 'failed', 'idle'],
  ended: ['buffering', 'idle'],
  failed: ['buffering', 'idle'],
};

function transition(state: PlayerMachineState, phase: PlayerPhase): PlayerMachineState {
  if (!allowedTransitions[state.phase].includes(phase)) return state;
  return { ...state, phase };
}

export function reducePlayerState(state: PlayerMachineState, event: PlayerMachineEvent): PlayerMachineState {
  switch (event.type) {
    case 'SELECT_TITLE':
      return state.phase === 'idle'
        ? { ...INITIAL_PLAYER_STATE, phase: 'resolving-identity', titleKey: event.titleKey }
        : state;
    case 'IDENTITY_RESOLVED':
      return transition(state, 'loading-streams');
    case 'STREAMS_LOADED':
      return transition(state, 'normalizing-candidates');
    case 'CANDIDATES_NORMALIZED':
      return transition(state, 'applying-quick-watch');
    case 'SOURCE_SELECTED': {
      const next = transition(state, 'buffering');
      return next === state ? state : { ...next, candidateId: event.candidateId, error: null };
    }
    case 'FILE_LOADED':
    case 'PLAYING':
      return transition(state, 'playing');
    case 'PAUSED':
      return transition(state, 'paused');
    case 'POSITION':
      return Number.isFinite(event.seconds) && event.seconds >= 0 ? { ...state, positionSeconds: event.seconds } : state;
    case 'DURATION':
      return Number.isFinite(event.seconds) && event.seconds >= 0 ? { ...state, durationSeconds: event.seconds } : state;
    case 'ENDED':
      return transition(state, 'ended');
    case 'FAILED': {
      const next = transition(state, 'failed');
      return next === state ? state : { ...next, error: event.message.slice(0, 240) };
    }
    case 'CANCEL':
    case 'RESET':
      return state.phase === 'idle' ? state : { ...INITIAL_PLAYER_STATE };
  }
}
