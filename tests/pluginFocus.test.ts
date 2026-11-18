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
function focus(env: Record<string, string> = {}) {
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
    writeFileSync(join(dir, 'open'), `#!/bin/sh\n${record}`, { mode: 0o755 });
    writeFileSync(join(dir, 'osascript'), `#!/bin/sh
${record}
while IFS= read -r line; do
  printf '%s\\n' "$line" >> "$FOCUS_TEST_APPLESCRIPT"
done
printf '%s\\n' "$FOCUS_TEST_OSASCRIPT_RESULT"
`, { mode: 0o755 });

    const result = spawnSync('/bin/sh', [focusScript], {
      encoding: 'utf8',
      timeout: 5000,
      // Do not inherit Codex or the terminal environment running the test.
      env: {
        ...env,
        NODE_ENV: 'test',
        PATH: dir,
        FOCUS_TEST_CALLS: callsFile,
        FOCUS_TEST_APPLESCRIPT: appleScriptFile,
        FOCUS_TEST_PLATFORM: env.FOCUS_TEST_PLATFORM ?? 'Darwin',
        FOCUS_TEST_OSASCRIPT_RESULT: env.FOCUS_TEST_OSASCRIPT_RESULT ?? 'ok',
      },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    return {
      calls: readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split('\t')),
      appleScript: readFileSync(appleScriptFile, 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
