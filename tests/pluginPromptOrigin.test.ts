import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('automatic popup requires an identifiable interactive root Codex session', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'inad-origin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = join(dir, 'rollout.jsonl');
  const hook = { hook_event_name: 'UserPromptSubmit', session_id: 'root', transcript_path: transcript };
  function classify(extra: Record<string, unknown> = {}) {
    return spawnSync('python3', [resolve('plugin/scripts/codex-context.py'), 'prompt-origin'], {
      input: JSON.stringify({ ...hook, ...extra }), encoding: 'utf8',
    }).stdout.trim();
  }
  function header(meta: Record<string, unknown>) {
    writeFileSync(transcript, JSON.stringify({ type: 'session_meta', payload: { id: 'root', ...meta } }) + '\n');
  }
  assert.equal(classify(), 'unknown', 'ephemeral session without a transcript');
  writeFileSync(transcript, '{incomplete');
  assert.equal(classify(), 'unknown');
  for (const source of ['cli', 'vscode', 'appServer']) {
    header({ source, thread_source: 'user' });
    assert.equal(classify(), 'user');
    assert.equal(classify({ thread_id: 'different' }), 'unknown');
    assert.equal(classify({ agent_id: 'worker' }), 'internal');
  }
  header({ source: 'vscode', thread_source: 'user', parent_thread_id: 'parent' });
  assert.equal(classify(), 'user', 'a user-owned fork');
  header({ id: 'child', session_id: 'root', source: { subagent: { thread_spawn: {} } } });
  assert.equal(classify(), 'internal', 'a child with the parent session ID');
  header({ source: 'exec', thread_source: 'user' });
  assert.equal(classify(), 'internal');
  header({ source: 'vscode', thread_source: 'automation' });
  assert.equal(classify(), 'internal');
  header({ source: 'future-source' });
  assert.equal(classify(), 'unknown');
  header({ id: 'another-session', source: 'cli' });
  assert.equal(classify(), 'unknown');
});
