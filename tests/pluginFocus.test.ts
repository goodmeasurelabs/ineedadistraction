import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const focusScript = resolve('plugin/scripts/focus.sh');
const iTermSession = 'A1234567-B123-C123-D123-E12345678901';

// Stub every external command the focus script uses. Nothing in this suite can
// open an app or execute AppleScript, even when it runs on a developer's Mac.
function focus(env: Record<string, string> = {}, args: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'inad-focus-test-'));
  const callsFile = join(dir, 'calls');
  const appleScriptFile = join(dir, 'applescript');
  try {
    writeFileSync(callsFile, '');
    writeFileSync(appleScriptFile, '');
    const record = `printf '%s' "\${0##*/}" >> "$FOCUS_TEST_CALLS"
printf '\\t%s' "$@" >> "$FOCUS_TEST_CALLS"
printf '\\n' >> "$FOCUS_TEST_CALLS"
`;
    writeFileSync(join(dir, 'uname'), '#!/bin/sh\nprintf "%s\\n" "$FOCUS_TEST_PLATFORM"\n', { mode: 0o755 });
    writeFileSync(join(dir, 'open'), `#!/bin/sh\n${record}
if [ "$#" -eq 3 ]; then exit "$FOCUS_TEST_LINK_EXIT"; fi
`, { mode: 0o755 });
    writeFileSync(join(dir, 'osascript'), `#!/bin/sh
${record}
while IFS= read -r line; do
  printf '%s\\n' "$line" >> "$FOCUS_TEST_APPLESCRIPT"
done
printf '%s\\n' "$FOCUS_TEST_OSASCRIPT_RESULT"
`, { mode: 0o755 });

    const result = spawnSync('/bin/sh', [focusScript, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      // Do not inherit Codex or the terminal environment running the test.
      env: {
        ...env,
        NODE_ENV: 'test',
        PATH: `${dir}:/usr/bin:/bin`,
        FOCUS_TEST_CALLS: callsFile,
        FOCUS_TEST_APPLESCRIPT: appleScriptFile,
        FOCUS_TEST_PLATFORM: env.FOCUS_TEST_PLATFORM ?? 'Darwin',
        FOCUS_TEST_OSASCRIPT_RESULT: env.FOCUS_TEST_OSASCRIPT_RESULT ?? 'ok',
        FOCUS_TEST_LINK_EXIT: env.FOCUS_TEST_LINK_EXIT ?? '0',
      },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return {
      calls: readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split('\t')),
      appleScript: readFileSync(appleScriptFile, 'utf8'),
      stdout: result.stdout,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a stored Codex route opens the exact chat without the original hook environment', () => {
  assert.equal(focus({ CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop' }, ['--target', iTermSession]).stdout,
    `chat ${iTermSession} com.openai.codex\n`);
  assert.deepEqual(focus({}, ['--open', 'chat', iTermSession, 'com.openai.codex']).calls, [
    ['open', '-b', 'com.openai.codex', `codex://threads/${iTermSession}`],
  ]);
});

test('route opening rejects malformed chat IDs and mismatched applications', () => {
  for (const id of [`${iTermSession}?view=review`, `${iTermSession}\nanything`, '../', '--args']) {
    assert.deepEqual(focus({}, ['--open', 'chat', id, 'com.openai.codex']).calls, []);
  }
  assert.deepEqual(focus({}, ['--open', 'pane', iTermSession, 'com.openai.codex']).calls, []);
});

test('a failed Codex chat link falls back to app activation', () => {
  assert.deepEqual(focus({ FOCUS_TEST_LINK_EXIT: '1' }, ['--open', 'chat', iTermSession, 'com.openai.codex']).calls, [
    ['open', '-b', 'com.openai.codex', `codex://threads/${iTermSession}`],
    ['open', '-b', 'com.openai.codex'],
  ]);
});

test('one dispatcher opens the selected completed chat and ignores stale or repeated requests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inad-dispatch-test-'));
  try {
    const seconds = 1_800_000_000;
    const now = seconds * 1000;
    writeFileSync(join(dir, 'token'), 'isolated-test-pairing-token');
    writeFileSync(join(dir, 'run.11'), `waiting done codex ${now} older ${now} chat ${iTermSession} com.openai.codex -\n`);
    writeFileSync(join(dir, 'run.22'), `working prompt codex ${now} newer ${now} chat a1234567-b123-c123-d123-e12345678902 com.openai.codex -\n`);
    writeFileSync(join(dir, 'sent.11'), 'older');
    writeFileSync(join(dir, 'sent.22'), 'newer');
    writeFileSync(join(dir, 'wait.11'), 'old listener');
    writeFileSync(join(dir, 'uname'), '#!/bin/sh\nprintf Darwin\n', { mode: 0o755 });
    writeFileSync(join(dir, 'date'), `#!/bin/sh\nprintf '%s\\n' ${seconds}\n`, { mode: 0o755 });
    writeFileSync(join(dir, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(dir, 'open'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$INAD_HOME/focus-calls"\n', { mode: 0o755 });
    writeFileSync(join(dir, 'curl'), `#!/bin/sh
if [ -f "$INAD_HOME/count" ]; then read -r count < "$INAD_HOME/count"; fi
count=$((\${count:-0} + 1))
printf '%s\\n' "$count" > "$INAD_HOME/count"
case "$count" in
  1) printf '{"seq":1,"attached":true,"focusAt":${now - 60_000},"focusRun":"22"}' ;;
  2|3) printf '{"seq":%s,"attached":true,"focusAt":${now},"focusRun":"11"}' "$count" ;;
  *) : > "$INAD_HOME/off" ;;
esac
`, { mode: 0o755 });
    const result = spawnSync('/bin/sh', [resolve('plugin/scripts/state.sh'), '--listen'], {
      encoding: 'utf8', timeout: 15000,
      env: { NODE_ENV: 'test', PATH: `${dir}:/usr/bin:/bin`, INAD_HOME: dir },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(dir, 'count'), 'utf8'), '4\n');
    assert.equal(readFileSync(join(dir, 'focus-calls'), 'utf8'), `-b com.openai.codex codex://threads/${iTermSession}\n`);
    assert.throws(() => readFileSync(join(dir, 'wait.11')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex Desktop returns to its app without terminal environment variables', () => {
  assert.deepEqual(focus({ CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop' }).calls, [
    ['open', '-b', 'com.openai.codex'],
  ]);
});

test('Codex Desktop takes precedence over inherited terminal and iTerm session variables', () => {
  assert.deepEqual(focus({
    CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop',
    TERM_PROGRAM: 'iTerm.app',
    ITERM_SESSION_ID: `w0t0p0:${iTermSession}`,
    __CFBundleIdentifier: 'com.googlecode.iterm2',
  }).calls, [['open', '-b', 'com.openai.codex']]);
});

test('Codex CLI still returns to the terminal that launched it', () => {
  assert.deepEqual(focus({
    CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'codex_cli_rs',
    TERM_PROGRAM: 'Apple_Terminal',
    __CFBundleIdentifier: 'com.apple.Terminal',
  }).calls, [['open', '-b', 'com.apple.Terminal']]);
});

test('Claude in iTerm selects the originating session instead of opening a generic window', () => {
  const result = focus({
    TERM_PROGRAM: 'iTerm.app',
    ITERM_SESSION_ID: `w0t0p0:${iTermSession}`,
    __CFBundleIdentifier: 'com.googlecode.iterm2',
  });
  assert.deepEqual(result.calls, [['osascript', '-', iTermSession]]);
  assert.match(result.appleScript, /tell application id "com\.googlecode\.iterm2"/);
  assert.match(result.appleScript, /if \(id of s as text\) is target then/);
  assert.match(result.appleScript, /tell w to select\s+tell t to select\s+tell s to select\s+activate/);
});

test('iTerm falls back to opening its app when the original session is gone', () => {
  assert.deepEqual(focus({
    TERM_PROGRAM: 'iTerm.app',
    ITERM_SESSION_ID: `w0t0p0:${iTermSession}`,
    __CFBundleIdentifier: 'com.googlecode.iterm2',
    FOCUS_TEST_OSASCRIPT_RESULT: 'none',
  }).calls, [['osascript', '-', iTermSession], ['open', '-b', 'com.googlecode.iterm2']]);
});

test('invalid iTerm session identifiers skip AppleScript and fall back to the terminal app', () => {
  assert.deepEqual(focus({
    TERM_PROGRAM: 'iTerm.app',
    ITERM_SESSION_ID: 'w0t0p0:invalid-session',
    __CFBundleIdentifier: 'com.googlecode.iterm2',
  }).calls, [['open', '-b', 'com.googlecode.iterm2']]);
});

test('missing or unsafe bundle identifiers do not invoke app activation', () => {
  assert.deepEqual(focus().calls, []);
  for (const bundle of ['com.apple.Terminal;echo unexpected', 'com.apple.Terminal extra', '/Applications/Terminal.app']) {
    assert.deepEqual(focus({ __CFBundleIdentifier: bundle }).calls, []);
  }
});

test('non-macOS platforms do not invoke app activation, including for Codex Desktop', () => {
  assert.deepEqual(focus({
    FOCUS_TEST_PLATFORM: 'Linux',
    CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop',
    __CFBundleIdentifier: 'com.openai.codex',
  }).calls, []);
});
