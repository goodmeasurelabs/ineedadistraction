import test from 'node:test';
import assert from 'node:assert/strict';
import { distractionHoldReducer, INITIAL_DISTRACTION_HOLD, type DistractionHoldEvent } from '../app/lib/distractionHold';

function player() {
  let state = { ...INITIAL_DISTRACTION_HOLD };
  return {
    event(event: DistractionHoldEvent) { state = distractionHoldReducer(state, event); return state; },
    snapshot(enabled: boolean | null | undefined, revision: number, appliedRevision = revision) {
      return this.event({ type: 'snapshot', enabled, revision, appliedRevision });
    },
  };
}

test('initial unknown settings and first acknowledged On do not create a local hold', () => {
  const p = player();
  assert.deepEqual(p.snapshot(undefined, 0), { held: false, observedOff: false });
  assert.deepEqual(p.snapshot(null, 0), { held: false, observedOff: false });
  assert.deepEqual(p.snapshot(true, 1), { held: false, observedOff: false });
});

test('Stop remains held after a 409 returns a newer acknowledged On game mix', () => {
  const p = player();
  p.snapshot(true, 3);
  assert.equal(p.event({ type: 'stop' }).held, true, 'pause before the save returns');
  // Another tab saved a different mix first, so this Stop conflicts. The
  // returned latest snapshot is On, but the user has never asked to resume.
  assert.deepEqual(p.snapshot(true, 4), { held: true, observedOff: false });
  assert.equal(p.snapshot(true, 5, 4).held, true, 'pending mix changes cannot resume');
  assert.equal(p.snapshot(true, 5).held, true, 'acknowledging that mix cannot resume');
  assert.equal(p.snapshot(undefined, 0).held, true, 'temporary connection loss cannot resume');
});

test('saved Off followed by remote On releases the hold only after the plugin applies On', () => {
  const p = player();
  p.snapshot(true, 1);
  p.event({ type: 'stop' });
  assert.deepEqual(p.snapshot(false, 2, 1), { held: true, observedOff: true });
  assert.equal(p.snapshot(false, 2).held, true, 'acknowledged Off stays paused');
  assert.equal(p.snapshot(true, 3, 2).held, true, 'remote On is still pending');
  assert.deepEqual(p.snapshot(true, 3), { held: false, observedOff: false });
});

test('explicit local On releases a failed Stop without requiring a saved Off', () => {
  const p = player();
  p.snapshot(true, 1);
  p.event({ type: 'stop' });
  p.snapshot(true, 2);
  assert.deepEqual(p.event({ type: 'on' }), { held: false, observedOff: false });
  assert.equal(p.snapshot(true, 3, 2).held, false, 'plugin acknowledgement is a separate playback gate');
});

test('a fresh Stop cannot reuse Off evidence from before the user explicitly resumed', () => {
  const p = player();
  p.event({ type: 'stop' });
  p.snapshot(false, 2);
  p.event({ type: 'on' });
  p.snapshot(true, 3, 2);
  p.event({ type: 'stop' });
  assert.deepEqual(p.snapshot(true, 3), { held: true, observedOff: false });
  p.snapshot(false, 4, 3);
  assert.deepEqual(p.snapshot(true, 5), { held: false, observedOff: false });
  p.event({ type: 'stop' });
  assert.equal(p.snapshot(true, 6).held, true, 'a completed remote cycle is not reused either');
});

test('unknown settings and unmatched or absent acknowledgements retain a hold after saved Off', () => {
  const p = player();
  p.event({ type: 'stop' });
  p.snapshot(false, 2, 1);
  assert.equal(p.snapshot(null, 0).held, true);
  assert.equal(p.snapshot(true, 0).held, true, 'zero is not an applied settings revision');
  assert.equal(p.snapshot(true, 3, 2).held, true);
  assert.equal(p.snapshot(true, 3, 4).held, true, 'acknowledgement must match the desired revision');
  assert.deepEqual(p.snapshot(true, 3), { held: false, observedOff: false });
});
