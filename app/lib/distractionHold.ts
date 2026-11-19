export type DistractionHoldState = {
  held: boolean;
  observedOff: boolean;
};

export type DistractionHoldEvent =
  | { type: 'stop' }
  | { type: 'on' }
  | { type: 'snapshot'; enabled: boolean | null | undefined; revision: number; appliedRevision: number };

export const INITIAL_DISTRACTION_HOLD: DistractionHoldState = { held: false, observedOff: false };

// This local hold protects the user's Stop intent while saving settings. The
// saved enabled value and pending plugin acknowledgement also pause playback.
export function distractionHoldReducer(state: DistractionHoldState, event: DistractionHoldEvent): DistractionHoldState {
  if (event.type === 'stop') return { held: true, observedOff: false };
  if (event.type === 'on') return { held: false, observedOff: false };
  if (event.enabled === false) return state.observedOff ? state : { ...state, observedOff: true };

  // A newer acknowledged On might only be another tab changing the game mix
  // after our Stop save failed. Require an observed saved Off before remote
  // On can release the hold; explicit local On always releases it immediately.
  if (event.enabled === true && event.revision > 0 && event.revision === event.appliedRevision && state.observedOff) {
    return { held: false, observedOff: false };
  }
  return state;
}
