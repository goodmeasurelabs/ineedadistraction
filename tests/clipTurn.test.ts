import test from 'node:test';
import assert from 'node:assert/strict';
import { clipPlaybackForQueue, trackClipTurn, type ClipTurn } from '../app/arcade/clips/clipTurn';
import type { AgentRunSnapshot } from '../app/lib/agentSession';

const first: ClipTurn = { run: 'chat-a', promptAt: 1000, revision: 4, state: 'working', reason: 'prompt' };

const working: AgentRunSnapshot = {
  ...first, agent: 'codex', updatedAt: 1000, acknowledged: false, dismissed: false, returnTarget: 'chat',
};

test('only a working foreground turn starts clips automatically', () => {
  const done: AgentRunSnapshot = { ...working, run: 'chat-b', revision: 5, state: 'idle', reason: 'done' };
  const queue = { foregroundRun: done.run, runs: [working, done], notice: null };
  assert.equal(clipPlaybackForQueue(queue, null).allowed, false);
  assert.equal(clipPlaybackForQueue({ ...queue, foregroundRun: 'closed-chat' }, null).allowed, false);
  assert.equal(clipPlaybackForQueue({ ...queue, foregroundRun: working.run }, null).allowed, true);
  assert.equal(clipPlaybackForQueue({ ...queue, foregroundRun: working.run, notice: done }, null).allowed, false);
});

test('only a local Play choice can resume a completed or acknowledged turn', () => {
  for (const state of ['waiting', 'idle'] as const) {
    const run: AgentRunSnapshot = { ...working, revision: 5, state, reason: state === 'idle' ? 'done' : 'question' };
    const notified = { foregroundRun: run.run, runs: [run], notice: run };
    const scope = clipPlaybackForQueue(notified, null).scope;
    assert.equal(clipPlaybackForQueue(notified, scope).allowed, false);
    const acknowledged = { ...notified, notice: null, runs: [{ ...run, acknowledged: true, dismissed: state === 'idle' }] };
    assert.equal(clipPlaybackForQueue(acknowledged, null).allowed, false);
    assert.equal(clipPlaybackForQueue(acknowledged, scope).allowed, true);
    assert.equal(clipPlaybackForQueue({ ...acknowledged, runs: [{ ...run, revision: 6 }] }, scope).allowed, false);
    assert.equal(clipPlaybackForQueue({ ...acknowledged, foregroundRun: 'another-chat' }, scope).allowed, false);
  }
});

test('manual playback with a closed chat belongs to that foreground only', () => {
  const closed = { foregroundRun: working.run, runs: [], notice: null };
  const scope = clipPlaybackForQueue(closed, null).scope;
  assert.equal(clipPlaybackForQueue(closed, scope).allowed, true);
  assert.equal(clipPlaybackForQueue({ ...closed, foregroundRun: null }, scope).allowed, false);
});

test('the initial prompt establishes a baseline and repeat polls or missing snapshots preserve it', () => {
  assert.deepEqual(trackClipTurn(undefined), { turn: undefined, rotate: false });
  assert.deepEqual(trackClipTurn(undefined, first), { turn: first, rotate: false });
  assert.deepEqual(trackClipTurn(first, { ...first }), { turn: first, rotate: false });
  assert.deepEqual(trackClipTurn(first), { turn: first, rotate: false });
  assert.deepEqual(trackClipTurn(first, { ...first, promptAt: 0, revision: 5 }), { turn: first, rotate: false });
});

test('rotate once for a newer prompt in an already-working chat or after its completed turn', () => {
  const done: ClipTurn = { ...first, revision: 5, state: 'idle', reason: 'done' };
  assert.deepEqual(trackClipTurn(first, done), { turn: done, rotate: false });
  const continued = { ...first, revision: 6 };
  assert.equal(trackClipTurn(done, continued).rotate, false, 'a continued Stop hook keeps the same prompt');
  const next = { ...first, promptAt: 1100, revision: 7 };
  for (const previous of [first, done]) {
    const change = trackClipTurn(previous, next);
    assert.deepEqual(change, { turn: next, rotate: true });
    assert.equal(trackClipTurn(change.turn, next).rotate, false);
  }
});

test('question and permission answers keep their clip even if submitted as a newer user prompt', () => {
  for (const reason of ['question', 'permission'] as const) {
    const waiting: ClipTurn = { ...first, revision: 5, state: 'waiting', reason };
    const held = trackClipTurn(first, waiting);
    assert.deepEqual(held, { turn: waiting, rotate: false });
    for (const promptAt of [first.promptAt, first.promptAt + 100]) {
      const answer = { ...first, promptAt, revision: 6 };
      const resumed = trackClipTurn(held.turn, answer);
      assert.deepEqual(resumed, { turn: answer, rotate: false });
      assert.equal(trackClipTurn(resumed.turn, { ...answer, promptAt: 1200, revision: 7 }).rotate, true);
    }
    assert.equal(trackClipTurn(held.turn, { ...first, run: 'chat-b', promptAt: 1200, revision: 6 }).rotate, true);
  }
});

test('a new turn first seen waiting selects its clip once, before the answer resumes playback', () => {
  for (const run of [first.run, 'chat-b']) {
    const waiting: ClipTurn = { ...first, run, promptAt: 1100, revision: 5, state: 'waiting', reason: 'question' };
    const held = trackClipTurn(first, waiting);
    assert.deepEqual(held, { turn: waiting, rotate: true });
    const stillWaiting: ClipTurn = { ...waiting, revision: 6, reason: 'permission' };
    assert.deepEqual(trackClipTurn(held.turn, stillWaiting), { turn: stillWaiting, rotate: false });
    const answer: ClipTurn = { ...stillWaiting, state: 'working', reason: 'prompt', revision: 7, promptAt: 1200 };
    assert.deepEqual(trackClipTurn(stillWaiting, answer), { turn: answer, rotate: false });
  }
});

test('a turn first seen completed does not consume a clip or prevent the next prompt selecting one', () => {
  const done: ClipTurn = { ...first, promptAt: 1100, revision: 5, state: 'idle', reason: 'done' };
  const skipped = trackClipTurn(first, done);
  assert.deepEqual(skipped, { turn: done, rotate: false });
  const next = { ...first, promptAt: 1200, revision: 6 };
  assert.deepEqual(trackClipTurn(skipped.turn, next), { turn: next, rotate: true });
});

test('foreground switches follow prompt order and stale reports cannot rewind the tracked turn', () => {
  const second = { ...first, run: 'chat-b', revision: 6 };
  const change = trackClipTurn(first, second);
  assert.deepEqual(change, { turn: second, rotate: true }, 'same-time foreground tie goes to the higher chat ID');
  const stale = [
    { ...first, revision: 7 },
    { ...first, revision: 8, promptAt: 999 },
    { ...first, revision: 5, promptAt: 1100 },
  ];
  for (const older of stale) assert.deepEqual(trackClipTurn(change.turn, older), { turn: second, rotate: false });
});
