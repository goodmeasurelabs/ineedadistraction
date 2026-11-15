import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRunId, rollUp } from '../app/lib/agentSession';

const run = (state: string, reason: string, agent: string, at: number) => ({ state, reason, agent, updatedAt: new Date(at) });

test('roll-up: a waiting agent wins over working ones, newest first', () => {
  const all = rollUp([run('working', 'prompt', 'codex', 5), run('waiting', 'permission', 'claude-code', 2), run('waiting', 'done', 'codex', 4)]);
  assert.deepEqual(all, { state: 'waiting', reason: 'done', agent: 'codex', working: 1, waiting: 2 });
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
