import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const plugin = resolve('plugin');
type Handler = { command: string };
type Group = { matcher?: string; hooks: Handler[] };

function session(agent: 'codex' | 'claude' = 'codex') {
  const manifest = JSON.parse(readFileSync(join(plugin, '.codex-plugin/plugin.json'), 'utf8'));
  const file = agent === 'codex' ? manifest.hooks : 'hooks/hooks.json';
  const hooks = JSON.parse(readFileSync(join(plugin, file), 'utf8')).hooks as Record<string, Group[]>;
  const dir = mkdtempSync(join(tmpdir(), 'inad-state-test-'));
  const transcript = join(dir, 'transcript.jsonl');
  writeFileSync(transcript, '');
  // The foreground state transition is real; background reports and macOS
  // helpers are stubbed so tests cannot access the network or switch apps.
  writeFileSync(join(dir, 'sh'), `#!/bin/sh
case "$1" in */open.sh|*/wait.sh) exit 0 ;; esac
[ "$2" = --send ] && exit 0
exec /bin/sh "$@"
`, { mode: 0o755 });
  writeFileSync(join(dir, 'uname'), '#!/bin/sh\nprintf Darwin\n', { mode: 0o755 });
  writeFileSync(join(dir, 'curl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(dir, 'token'), 'isolated-test-pairing-token');
  writeFileSync(join(dir, 'no-auto-open'), '');
  return {
    event(event: string, fields: Record<string, unknown> = {}, reverse = false) {
      const input = {
        session_id: 'root-session',
        turn_id: 'test-turn',
        transcript_path: agent === 'codex' ? transcript : '/isolated/.claude/transcript.jsonl',
        hook_event_name: event,
        ...fields,
      };
      const groups = [...(hooks[event] ?? [])];
      if (reverse) groups.reverse();
      for (const group of groups) {
        if (group.matcher && !new RegExp(group.matcher).test(String(fields.tool_name ?? ''))) continue;
        for (const handler of group.hooks) {
          const result = spawnSync('/bin/sh', ['-c', handler.command], {
            input: JSON.stringify(input), encoding: 'utf8', timeout: 5000,
            env: {
              NODE_ENV: 'test',
              PATH: `${dir}:/usr/bin:/bin`, INAD_HOME: dir,
              CLAUDE_PLUGIN_ROOT: plugin,
              ...(agent === 'codex' ? { PLUGIN_ROOT: plugin } : {}),
            },
          });
          assert.ifError(result.error);
          assert.equal(result.status, 0, result.stderr);
          assert.equal(result.stderr, '');
          assert.ok(result.stdout === '' || result.stdout === '{}', result.stdout);
        }
      }
      return readFileSync(join(dir, 'last'), 'utf8');
    },
    answer(call: string, index = 0) {
      const reply = [{ questionItemId: JSON.stringify(['request_user_input_async', call, index]), answer: 'yes' }];
      appendFileSync(transcript, JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `<send_user_message_question_reply>\n${JSON.stringify(reply)}\n</send_user_message_question_reply>` }] },
      }) + '\n');
    },
    approvalMode(reviewer: string, policy = 'on-request') {
      appendFileSync(transcript, JSON.stringify({
        type: 'turn_context', payload: { turn_id: 'test-turn', approvals_reviewer: reviewer, approval_policy: policy },
      }) + '\n');
    },
    clearLastReport() { rmSync(join(dir, 'last')); },
    close() { rmSync(dir, { recursive: true, force: true }); },
  };
}

test('a new Codex prompt reports working again when the same session survived a restart', () => {
  const s = session();
  try {
    s.event('UserPromptSubmit');
    s.clearLastReport();
    assert.equal(s.event('UserPromptSubmit'), 'working prompt codex');
    assert.equal(s.event('Stop'), 'waiting done codex');
  } finally { s.close(); }
});

test('Codex stays working through tools and resumes a continued Stop before root sampling', () => {
  const s = session();
  try {
    assert.equal(s.event('UserPromptSubmit'), 'working prompt codex');
    assert.equal(s.event('PreToolUse', { tool_name: 'Bash' }), 'working prompt codex');
    assert.equal(s.event('PostToolUse', { tool_name: 'Bash' }), 'working prompt codex');
    assert.equal(s.event('Stop'), 'waiting done codex');
    assert.equal(s.event('PreModelRequest', { kind: 'sampling', thread_id: 'root-session' }), 'working prompt codex');
    assert.equal(s.event('Stop', { stop_hook_active: true }), 'waiting done codex');
  } finally { s.close(); }
});

test('Codex compaction, child sampling, and unknown events cannot change a completed root turn', () => {
  const s = session();
  try {
    s.event('UserPromptSubmit');
    s.event('Stop');
    assert.equal(s.event('SubagentStop'), 'waiting done codex');
    assert.equal(s.event('Notification'), 'waiting done codex');
    for (const fields of [
      { kind: 'foreground_compaction' },
      { kind: 'background_compaction' },
      { kind: 'sampling', agent_id: 'child-agent' },
      { kind: 'sampling', thread_id: 'child-thread' },
      {},
    ]) {
      assert.equal(s.event('PreModelRequest', fields), 'waiting done codex');
    }
  } finally { s.close(); }
});

test('synchronous question hooks pause until answered, regardless of handler order', () => {
  for (const agent of ['codex', 'claude'] as const) {
    const tool = agent === 'codex' ? 'request_user_input' : 'AskUserQuestion';
    for (const reverse of [false, true]) {
      const s = session(agent);
      const label = agent === 'codex' ? 'codex' : 'claude-code';
      try {
        s.event('UserPromptSubmit');
        assert.equal(s.event('PreToolUse', { tool_name: tool }, reverse), `waiting question ${label}`);
        if (agent === 'codex') assert.equal(s.event('PostToolUse', { tool_name: 'Bash' }), 'waiting question codex');
        assert.equal(s.event('PostToolUse', { tool_name: tool }), `working prompt ${label}`);
      } finally { s.close(); }
    }
  }
});

test('async Codex questions stay paused while the tool and unrelated work complete', () => {
  const s = session();
  try {
    s.event('UserPromptSubmit');
    const question = { tool_name: 'request_user_input_async', tool_use_id: 'call_async', tool_input: { questions: [{ title: 'Continue?' }] } };
    assert.equal(s.event('PreToolUse', question), 'waiting question codex');
    assert.equal(s.event('PostToolUse', question), 'waiting question codex');
    assert.equal(s.event('PreToolUse', { tool_name: 'Bash' }), 'waiting question codex');
    assert.equal(s.event('PostToolUse', { tool_name: 'Bash' }), 'waiting question codex');
    assert.equal(s.event('PreModelRequest', { kind: 'sampling' }), 'waiting question codex');
    s.answer('call_async');
    assert.equal(s.event('PreModelRequest', { kind: 'sampling' }), 'working prompt codex');
  } finally { s.close(); }
});

test('multiple async questions resume only after every pending answer arrives', () => {
  const s = session();
  try {
    s.event('UserPromptSubmit');
    s.event('PreToolUse', { tool_name: 'request_user_input_async', tool_use_id: 'call_first', tool_input: { questions: [{ title: 'A?' }, { title: 'B?' }] } });
    s.event('PreToolUse', { tool_name: 'request_user_input_async', tool_use_id: 'call_second', tool_input: { questions: [{ title: 'C?' }] } });
    s.answer('call_first', 0);
    assert.equal(s.event('PostToolUse', { tool_name: 'Bash' }), 'waiting question codex');
    s.answer('call_first', 1);
    assert.equal(s.event('PostToolUse', { tool_name: 'Bash' }), 'waiting question codex');
    s.answer('call_second');
    assert.equal(s.event('PostToolUse', { tool_name: 'Bash' }), 'working prompt codex');
  } finally { s.close(); }
});

test('unknown async metadata preserves the pause until a fresh user prompt', () => {
  const s = session();
  try {
    s.event('UserPromptSubmit');
    s.event('PreToolUse', { tool_name: 'request_user_input_async' });
    assert.equal(s.event('PostToolUse', { tool_name: 'Bash' }), 'waiting question codex');
    assert.equal(s.event('UserPromptSubmit'), 'working prompt codex');
    assert.equal(s.event('PreModelRequest', { kind: 'sampling' }), 'working prompt codex');
  } finally { s.close(); }
});

test('permission prompts still pause and tool completion clears them', () => {
  const s = session();
  try {
    s.event('UserPromptSubmit');
    assert.equal(s.event('PermissionRequest', { tool_name: 'Bash' }), 'waiting permission codex');
    assert.equal(s.event('PostToolUse', { tool_name: 'Bash' }), 'working prompt codex');
  } finally { s.close(); }
});

test('automatic Codex shell approvals keep working while questions and final replies still pause', () => {
  const s = session();
  try {
    s.approvalMode('auto_review');
    s.event('UserPromptSubmit');
    for (const tool_name of ['Bash', 'apply_patch', 'exec_command']) {
      assert.equal(s.event('PermissionRequest', { tool_name }), 'working prompt codex');
    }
    const question = { tool_name: 'request_user_input_async', tool_use_id: 'call_auto', tool_input: { questions: [{ title: 'Continue?' }] } };
    assert.equal(s.event('PreToolUse', question), 'waiting question codex');
    assert.equal(s.event('PermissionRequest', { tool_name: 'Bash' }), 'waiting question codex');
    s.answer('call_auto');
    assert.equal(s.event('PostToolUse', { tool_name: 'Bash' }), 'working prompt codex');
    assert.equal(s.event('Stop'), 'waiting done codex');
  } finally { s.close(); }
});

test('manual Codex checks, app approvals, and Claude permissions retain their pauses', () => {
  for (const example of [
    { agent: 'codex' as const, reviewer: 'user', tool: 'Bash' },
    { agent: 'codex' as const, reviewer: 'auto_review', tool: 'mcp__example__write' },
    { agent: 'codex' as const, reviewer: 'auto_review', tool: 'request_permissions' },
    { agent: 'claude' as const, reviewer: 'auto_review', tool: 'Bash' },
  ]) {
    const s = session(example.agent);
    try {
      s.approvalMode(example.reviewer);
      s.event('UserPromptSubmit');
      assert.equal(s.event('PermissionRequest', { tool_name: example.tool }), `waiting permission ${example.agent === 'codex' ? 'codex' : 'claude-code'}`);
    } finally { s.close(); }
  }
});

test('Codex sampling recovery leaves real input waits and Claude state alone', () => {
  for (const agent of ['codex', 'claude'] as const) {
    const s = session(agent);
    const label = agent === 'codex' ? 'codex' : 'claude-code';
    try {
      s.event('UserPromptSubmit');
      s.event('PermissionRequest', { tool_name: 'Bash' });
      assert.equal(s.event('PreModelRequest', { kind: 'sampling' }), `waiting permission ${label}`);
      s.event('Stop');
      if (agent === 'claude') assert.equal(s.event('PreModelRequest', { kind: 'sampling' }), 'waiting done claude-code');
    } finally { s.close(); }
  }
});
