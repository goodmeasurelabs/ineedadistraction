import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const plugin = resolve('plugin');
type Handler = { command: string };
type Group = { matcher?: string; hooks: Handler[] };

function session(agent: 'codex' | 'claude' = 'codex', options: { autoOpen?: boolean; os?: 'Darwin' | 'Linux'; noReturn?: boolean; sessionId?: string } = {}) {
  const manifest = JSON.parse(readFileSync(join(plugin, '.codex-plugin/plugin.json'), 'utf8'));
  const file = agent === 'codex' ? manifest.hooks : 'hooks/hooks.json';
  const hooks = JSON.parse(readFileSync(join(plugin, file), 'utf8')).hooks as Record<string, Group[]>;
  const dir = mkdtempSync(join(tmpdir(), 'inad-state-test-'));
  const root = options.sessionId ?? 'root-session';
  function writeTranscript(id: string, meta: Record<string, unknown> = {}) {
    const path = join(dir, `${id}.jsonl`);
    writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { id, source: 'vscode', thread_source: 'user', ...meta } }) + '\n');
    return path;
  }
  const transcript = writeTranscript(root);
  // The foreground state transition is real; background reports and macOS
  // helpers are stubbed so tests cannot access the network or switch apps.
  writeFileSync(join(dir, 'sh'), `#!/bin/sh
case "$1" in
  */open.sh) shift; printf '%s\\n' "$*" >> "$INAD_HOME/opens"; exit 0 ;;
  */wait.sh) exit 0 ;;
esac
case "$2" in --send|--listen) exit 0 ;; esac
exec /bin/sh "$@"
`, { mode: 0o755 });
  writeFileSync(join(dir, 'uname'), `#!/bin/sh\nprintf '${options.os ?? 'Darwin'}'\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'curl'), `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = -d ]; then
    printf '%s\\n' "$2" >> "$INAD_HOME/request-bodies"
    break
  fi
  shift
done
[ "$TEST_REQUEST_FAILURE" = 1 ] && exit 1
printf '{"attached":false}'
`, { mode: 0o755 });
  writeFileSync(join(dir, 'token'), 'isolated-test-pairing-token');
  if (!options.autoOpen) writeFileSync(join(dir, 'no-auto-open'), '');
  if (options.noReturn) writeFileSync(join(dir, 'no-return'), '');
  function runFile() {
    const file = readdirSync(dir).find((name) => /^run\.\d+$/.test(name));
    assert.ok(file, 'expected a local run record');
    return file;
  }
  return {
    writeTranscript,
    runFiles() { return readdirSync(dir).filter((name) => /^run\.\d+$/.test(name)).sort(); },
    event(event: string, fields: Record<string, unknown> = {}, reverse = false) {
      const input = {
        session_id: root,
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
              __CFBundleIdentifier: 'com.apple.Terminal',
              ...(agent === 'codex' ? { PLUGIN_ROOT: plugin, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop' } : {}),
            },
          });
          assert.ifError(result.error);
          assert.equal(result.status, 0, result.stderr);
          assert.equal(result.stderr, '');
          assert.ok(result.stdout === '' || result.stdout === '{}', result.stdout);
        }
      }
      const last = join(dir, 'last');
      return existsSync(last) ? readFileSync(last, 'utf8') : '';
    },
    record() {
      const [state, reason, label, at, id, promptAt, target, locator] = readFileSync(join(dir, runFile()), 'utf8').trim().split(' ');
      return { state, reason, label, at: Number(at), id, promptAt: Number(promptAt), target, locator };
    },
    send(fail = false, originSession = '') {
      const sid = runFile().slice(4);
      const result = spawnSync('/bin/sh', [join(plugin, 'scripts/state.sh'), '--send', originSession, sid], {
        encoding: 'utf8', timeout: 5000,
        env: { NODE_ENV: 'test', PATH: `${dir}:/usr/bin:/bin`, INAD_HOME: dir, TEST_REQUEST_FAILURE: fail ? '1' : '' },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return readFileSync(join(dir, 'request-bodies'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    },
    async opens(expected: number) {
      const path = join(dir, 'opens');
      const read = () => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : [];
      // The launcher is detached; allow a slow worker to reach the stub.
      const deadline = Date.now() + 2000;
      while (read().length < expected && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      return read();
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

test('only fresh interactive Codex prompts may raise the Mac popup, even when return-to-agent is disabled', async () => {
  const s = session('codex', { autoOpen: true, noReturn: true });
  try {
    s.event('UserPromptSubmit', { agent_id: 'worker' });
    s.event('UserPromptSubmit', { transcript_path: '/missing/transcript.jsonl' });
    s.event('UserPromptSubmit');
    assert.equal(s.record().target, 'unavailable');
    assert.deepEqual(await s.opens(1), ['--resurface com.openai.codex first']);
    s.event('PermissionRequest', { tool_name: 'Bash' });
    s.event('PostToolUse', { tool_name: 'Bash' });
    s.event('Stop');
    s.event('PreModelRequest', { kind: 'sampling' });
    // Releasing a delayed working-state report while detached must have no UI effect.
    s.send(false, 'root-session');
    s.event('UserPromptSubmit');
    assert.deepEqual(await s.opens(2), ['--resurface com.openai.codex first', '--resurface com.openai.codex']);
  } finally { s.close(); }
});

test('Mac Claude child hooks do not open the popup and a user prompt carries its originating terminal', async () => {
  const s = session('claude', { autoOpen: true });
  try {
    s.event('UserPromptSubmit', { transcript_path: '/isolated/.claude/subagents/agent-12.jsonl' });
    s.event('UserPromptSubmit', { agent_id: 'worker' });
    s.event('UserPromptSubmit');
    assert.deepEqual(await s.opens(1), ['--resurface com.apple.Terminal first']);
  } finally { s.close(); }
});

test('automatic opening on other platforms happens once per session, including interleaved chats', async () => {
  const s = session('claude', { autoOpen: true, os: 'Linux' });
  try {
    s.event('UserPromptSubmit');
    s.event('UserPromptSubmit');
    s.event('UserPromptSubmit', { session_id: 'other-session' });
    s.event('UserPromptSubmit');
    s.send(false, 'other-session');
    assert.deepEqual(await s.opens(2), ['--background', '--background']);
  } finally { s.close(); }
});

test('prompt identity survives a coalesced stop, retries, duplicates, and a fast quit', () => {
  const session_id = 'a1234567-b123-c123-d123-e12345678901';
  const s = session('codex', { sessionId: session_id });
  try {
    s.event('UserPromptSubmit', { session_id, prompt: 'private prompt' });
    const working = s.record();
    s.event('Stop', { session_id });
    const finished = s.record();
    s.event('Stop', { session_id, stop_hook_active: true });
    s.event('SessionEnd', { session_id });
    assert.deepEqual(s.record(), finished);
    assert.equal(finished.promptAt, working.at);
    assert.ok(finished.at > working.at);
    assert.notEqual(finished.id, working.id);
    assert.equal(finished.target, 'chat');
    assert.equal(finished.locator, session_id);
    const [failed] = s.send(true);
    assert.deepEqual(s.send(), [failed, failed]);
    assert.deepEqual(s.send(), [failed, failed]);
    assert.deepEqual(failed, {
      state: 'waiting', reason: 'done', agent: 'codex', session: failed.session,
      eventAt: finished.at, eventId: finished.id, promptAt: working.at, returnTarget: 'chat',
    });
    assert.notEqual(failed.session, session_id);
  } finally { s.close(); }
});

test('an unsaved Codex session after a completed user turn cannot replace its foreground or send a report', () => {
  const s = session();
  try {
    s.event('UserPromptSubmit');
    assert.equal(s.event('Stop'), 'waiting done codex');
    const finished = s.record();
    const sent = s.send();
    const originalRuns = s.runFiles();
    const background = { session_id: 'ephemeral', transcript_path: '/missing/ephemeral.jsonl' };
    for (const event of ['UserPromptSubmit', 'PreModelRequest', 'Stop', 'SessionEnd']) {
      assert.equal(s.event(event, { ...background, kind: 'sampling' }), 'waiting done codex');
      assert.deepEqual(s.runFiles(), originalRuns);
      assert.deepEqual(s.record(), finished);
    }
    assert.deepEqual(s.send(), sent);
  } finally { s.close(); }
});

test('a Codex child sharing the parent session cannot finish its active turn or restart its completed turn', () => {
  const s = session();
  try {
    s.event('UserPromptSubmit');
    const working = s.record();
    const child = { transcript_path: s.writeTranscript('child', {
      session_id: 'root-session', source: { subagent: { thread_spawn: {} } }, thread_source: 'subagent',
    }) };
    s.event('Stop', child);
    assert.deepEqual(s.record(), working);
    s.event('Stop');
    const finished = s.record();
    for (const fields of [child, { agent_id: 'child' }]) {
      for (const event of ['UserPromptSubmit', 'PreModelRequest', 'SessionEnd']) {
        s.event(event, { ...fields, kind: 'sampling' });
        assert.deepEqual(s.record(), finished);
      }
    }
    assert.equal(s.runFiles().length, 1);
  } finally { s.close(); }
});

test('separately prompted user-owned Codex chats and forks keep independent runs', () => {
  const s = session();
  try {
    s.event('UserPromptSubmit');
    s.event('Stop');
    const fork = { session_id: 'fork', thread_id: 'fork', transcript_path: s.writeTranscript('fork', { parent_thread_id: 'root-session' }) };
    assert.equal(s.event('UserPromptSubmit', fork), 'working prompt codex');
    assert.equal(s.event('Stop', fork), 'waiting done codex');
    assert.equal(s.runFiles().length, 2);
  } finally { s.close(); }
});

test('a second question gets a new notification version while repeated calls do not', () => {
  const s = session();
  try {
    s.event('UserPromptSubmit');
    const ask = (tool_use_id: string) => s.event('PreToolUse', {
      tool_name: 'request_user_input_async', tool_use_id, tool_input: { questions: [{ title: 'Continue?' }] },
    });
    ask('call_first');
    const first = s.record();
    ask('call_first');
    assert.deepEqual(s.record(), first);
    ask('call_next');
    const next = s.record();
    assert.ok(next.at > first.at);
    assert.notEqual(next.id, first.id);
    assert.equal(next.promptAt, first.promptAt);
    assert.equal(s.event('Stop'), 'waiting question codex');
    assert.deepEqual(s.record(), next);
  } finally { s.close(); }
});

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
