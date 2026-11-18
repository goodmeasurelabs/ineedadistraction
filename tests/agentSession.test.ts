import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRunId, rollUp, shouldPauseForAgent } from '../app/lib/agentSession';

const run = (state: string, reason: string, agent: string, at: number) => ({ state, reason, agent, updatedAt: new Date(at) });

test('roll-up: fresh waits interrupt a working agent, newest first', () => {
  const all = rollUp([run('working', 'prompt', 'codex', 1), run('waiting', 'permission', 'claude-code', 2), run('waiting', 'done', 'codex', 4)]);
  assert.deepEqual(all, { state: 'waiting', reason: 'done', agent: 'codex', working: 1, waiting: 2 });
});

test('a fresh prompt supersedes abandoned waits and its completion still pauses the game', () => {
  const abandoned = [run('waiting', 'done', 'codex', 2), run('waiting', 'permission', 'claude-code', 3)];
  assert.deepEqual(rollUp([...abandoned, run('working', 'prompt', 'codex', 4)]), {
    state: 'working', reason: 'prompt', agent: 'codex', working: 1, waiting: 0,
  });
  assert.equal(rollUp([...abandoned, run('waiting', 'done', 'codex', 5)]).reason, 'done');
});

test('the game pauses for a fresh wait even when polling misses the working state', () => {
  const waiting = { state: 'waiting', waitedAt: 20 };
  assert.equal(shouldPauseForAgent({ state: 'idle', waitedAt: 0 }, waiting, 10), true);
  assert.equal(shouldPauseForAgent({ state: 'unpaired', waitedAt: 0 }, waiting, 10), true);
  assert.equal(shouldPauseForAgent({ state: 'unpaired', waitedAt: 0 }, waiting, 30), false);
  assert.equal(shouldPauseForAgent(waiting, waiting, 10), false);
});

test('roll-up: working when nobody waits, idle when nobody is left', () => {
  assert.deepEqual(rollUp([run('working', 'prompt', 'codex', 1), run('working', 'prompt', 'claude-code', 2)]), { state: 'working', reason: 'prompt', agent: 'claude-code', working: 2, waiting: 0 });
  assert.deepEqual(rollUp([]), { state: 'idle', reason: null, agent: null, working: 0, waiting: 0 });
});

test('run ids are reduced to safe characters, with a default for old plugins', () => {
  assert.equal(cleanRunId(undefined), 'default');
  assert.equal(cleanRunId(''), 'default');
  assert.equal(cleanRunId(3128765), '3128765');
  assert.equal(cleanRunId('a b/../c'), 'abc');
  assert.equal(cleanRunId('x'.repeat(80)).length, 40);
});
