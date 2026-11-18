import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const helper = resolve('plugin/scripts/codex-context.py');
const privateText = 'PRIVATE QUESTION OR ANSWER MUST NOT BE SAVED';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'inad-context-test-'));
  const questions = join(root, 'questions');
  const transcript = join(root, 'transcript.jsonl');
  const invoke = (args: string[], input?: unknown) => {
    const result = spawnSync('python3', [helper, ...args], {
      input: input === undefined ? undefined : JSON.stringify(input),
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.stderr, '');
    assert.ok(!result.stdout.includes(privateText));
    return result;
  };
  return {
    root, questions, transcript, invoke,
    register(callId: string, count: number) {
      const result = invoke(['register', questions], {
        tool_use_id: callId,
        tool_input: { questions: Array.from({ length: count }, () => ({ title: privateText })) },
      });
      assert.equal(result.status, 0);
    },
    write(events: unknown[]) {
      writeFileSync(transcript, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
    },
    pending() { return invoke(['pending', questions, transcript]).stdout.trim(); },
    marker(callId: string) { return JSON.parse(readFileSync(join(questions, `${callId}.json`), 'utf8')); },
    close() { rmSync(root, { recursive: true, force: true }); },
  };
}

function reply(callId: string, index: unknown, role = 'user', tool = 'request_user_input_async') {
  return {
    type: 'response_item',
    payload: {
      type: 'message', role,
      content: [{ type: 'input_text', text: `<send_user_message_question_reply>\n${JSON.stringify([
        { questionItemId: JSON.stringify([tool, callId, index]), question: privateText, answer: privateText },
      ])}\n</send_user_message_question_reply>` }],
    },
  };
}

function output(callId: string, value: unknown) {
  return { type: 'response_item', payload: { type: 'function_call_output', call_id: callId, output: JSON.stringify(value) } };
}

test('question markers retain only identifiers, counts and answered indices', () => {
  const f = fixture();
  try {
    f.register('call_private_1', 2);
    assert.deepEqual(f.marker('call_private_1'), { tool_use_id: 'call_private_1', question_count: 2, answered_indices: [] });
    assert.ok(!readFileSync(join(f.questions, 'call_private_1.json'), 'utf8').includes(privateText));
    assert.equal(f.pending(), 'pending'); // Missing transcript is conservative.
  } finally { f.close(); }
});

test('all questions across all calls must be answered; accepted tool output is not an answer', () => {
  const f = fixture();
  try {
    f.register('call_A', 2);
    f.register('call_B', 1);
    f.write([output('call_A', { accepted: true }), reply('call_A', 0), reply('call_B', 0)]);
    assert.equal(f.pending(), 'pending');
    assert.deepEqual(f.marker('call_A').answered_indices, [0]);
    assert.ok(!readdirSync(f.questions).includes('call_B.json'));
    // Simulate older replies leaving the bounded transcript tail.
    f.write([reply('call_A', 1)]);
    assert.equal(f.pending(), 'clear');
    assert.deepEqual(readdirSync(f.questions), ['.lock']);
  } finally { f.close(); }
});

test('replayed answers count once and repeated registration preserves partial answers', () => {
  const f = fixture();
  try {
    f.register('call_repeat', 2);
    f.write([reply('call_repeat', 0), reply('call_repeat', 0)]);
    assert.equal(f.pending(), 'pending');
    assert.equal(f.pending(), 'pending');
    f.register('call_repeat', 2);
    assert.deepEqual(f.marker('call_repeat').answered_indices, [0]);
    f.write([reply('call_repeat', 1)]);
    assert.equal(f.pending(), 'clear');
  } finally { f.close(); }
});

test('mismatched calls, tools, roles and invalid question indices do not clear questions', () => {
  const f = fixture();
  try {
    f.register('call_real', 1);
    f.write([
      reply('call_other', 0), reply('call_real', 0, 'assistant'),
      reply('call_real', 0, 'user', 'request_user_input'),
      ...[-1, 1, '0', true, null].map((index) => reply('call_real', index)),
    ]);
    assert.equal(f.pending(), 'pending');
    assert.deepEqual(f.marker('call_real').answered_indices, []);
    f.write([reply('call_real', 0)]);
    assert.equal(f.pending(), 'clear');
  } finally { f.close(); }
});

test('ordinary message text and malformed reply metadata do not count as answers', () => {
  const f = fixture();
  try {
    f.register('call_real', 1);
    const wrapped = reply('call_real', 0);
    wrapped.payload.content[0].text = `Example only: ${wrapped.payload.content[0].text}`;
    const noAnswer = reply('call_real', 0);
    noAnswer.payload.content[0].text = '<send_user_message_question_reply>\n' + JSON.stringify([
      { questionItemId: JSON.stringify(['request_user_input_async', 'call_real', 0]) },
      { questionItemId: 'not json', answer: privateText },
    ]) + '\n</send_user_message_question_reply>';
    f.write([wrapped, noAnswer]);
    assert.equal(f.pending(), 'pending');
  } finally { f.close(); }
});

test('an explicitly rejected async call clears only its own marker', () => {
  const f = fixture();
  try {
    f.register('call_rejected', 1);
    f.register('call_error', 1);
    f.register('call_other', 1);
    f.write([
      output('call_rejected', { accepted: false }),
      output('call_error', { isError: true }),
      output('call_other', { accepted: 'false', isError: 'true' }),
    ]);
    assert.equal(f.pending(), 'pending');
    assert.deepEqual(readdirSync(f.questions).sort(), ['.lock', 'call_other.json']);
  } finally { f.close(); }
});

test('unknown and corrupt markers remain pending, even after recognized questions resolve', () => {
  const f = fixture();
  try {
    f.register('call_real', 1);
    writeFileSync(join(f.questions, 'unknown'), '');
    writeFileSync(join(f.questions, 'broken.json'), '{');
    f.write([reply('call_real', 0)]);
    assert.equal(f.pending(), 'pending');
    assert.ok(!readdirSync(f.questions).includes('call_real.json'));
  } finally { f.close(); }
});

test('invalid registrations fail without creating a path from untrusted call IDs', () => {
  const f = fixture();
  try {
    for (const callId of ['', '../outside', 'call/escape', 'x'.repeat(129)]) {
      const result = f.invoke(['register', f.questions], { tool_use_id: callId, tool_input: { questions: [{}] } });
      assert.notEqual(result.status, 0);
    }
    assert.equal(f.pending(), 'clear');
  } finally { f.close(); }
});

test('bounded tail tolerates a cut JSON line and processes recent replies', () => {
  const f = fixture();
  try {
    f.register('call_recent', 1);
    writeFileSync(f.transcript, JSON.stringify({ type: 'unrelated', padding: 'x'.repeat(17 * 1024 * 1024) }) + '\n'
      + JSON.stringify(reply('call_recent', 0)) + '\n');
    assert.equal(f.pending(), 'clear');
  } finally { f.close(); }
});
