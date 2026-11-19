import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(resolve('plugin/scripts/raise.js'), 'utf8');
const origin = 'com.openai.codex';
const browser = 'com.google.Chrome';

function windowManager() {
  const state = {
    elapsed: 0, activations: 0, foreground: origin, window: 'visible', off: false,
    tick: () => {},
  };
  const context = vm.createContext({
    ObjC: { import() {}, unwrap: (text: string) => text },
    Date: { now: () => state.elapsed },
    delay(seconds: number) {
      state.elapsed += seconds * 1000;
      assert.ok(state.elapsed <= 5200, 'foreground requests have a fixed deadline');
      state.tick();
    },
    $: {
      NSWorkspace: { sharedWorkspace: {
        get frontmostApplication() { return { isNil: () => false, bundleIdentifier: state.foreground }; },
      } },
      NSFileManager: { defaultManager: { fileExistsAtPath: () => state.off } },
      NSRunningApplication: { runningApplicationWithProcessIdentifier: () => ({
        isNil: () => false, get active() { return state.foreground === 'popup'; },
        activateWithOptions() { state.activations++; },
      }) },
    },
  });
  vm.runInContext(script, context);
  context.popupWindows = () => state.window === 'closed' ? [] : [{ kCGWindowIsOnscreen: state.window === 'visible' }];
  const front = (wait: boolean, source?: string) => context.front(123, wait, source, '/fixture/prefs') as string;
  return { state, front };
}

test('automatic activation requires the originating app to be foreground when the window is ready', () => {
  const { state, front } = windowManager();
  state.foreground = browser;
  assert.equal(front(false, origin), 'skipped');
  state.foreground = origin;
  assert.equal(front(false, ''), 'skipped');
  state.window = 'closed';
  state.tick = () => { state.foreground = browser; state.window = 'visible'; };
  assert.equal(front(true, origin), 'skipped');
  assert.equal(state.activations, 0);
});

test('a denied focus request is made just once, with a bounded deadline', () => {
  for (const wait of [false, true]) {
    const { state, front } = windowManager();
    assert.equal(front(wait, origin), 'skipped');
    assert.equal(state.activations, 1);
    assert.ok(state.elapsed <= 750);
  }
});

test('a successful launch, hidden window and closed window have distinct outcomes', () => {
  const { state, front } = windowManager();
  state.window = 'closed';
  assert.equal(front(false, origin), 'none');
  state.window = 'minimized';
  assert.equal(front(false, origin), 'skipped');
  state.window = 'visible';
  state.off = true;
  assert.equal(front(false, origin), 'skipped');
  assert.equal(state.activations, 0);
  state.off = false;
  state.tick = () => { state.foreground = 'popup'; };
  assert.equal(front(false, origin), 'ok');
  assert.equal(state.activations, 1);
  assert.equal(front(false, origin), 'ok');
  assert.equal(state.activations, 1);
});

function launcher(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'inad-popup-launch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'token'), 'isolated-test-pairing-token');
  writeFileSync(join(dir, 'calls'), '');
  writeFileSync(join(dir, 'no-return'), '');
  function shim(name: string, body: string) {
    writeFileSync(join(dir, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
  }
  shim('uname', 'echo Darwin');
  shim('python3', 'exit 0');
  shim('sleep', 'exit 0');
  shim('ps', `if [ "$MOCK_PID" = running ] || [ -f "$INAD_HOME/launched" ]; then
  chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  echo " 101 $chrome --user-data-dir=$INAD_HOME/browser-other"
  echo " 102 $chrome --type=renderer --user-data-dir=$INAD_HOME/browser"
  echo " 123 $chrome --no-first-run --user-data-dir=$INAD_HOME/browser"
fi`);
  shim('osascript', `echo "$4 $5 $6 $7" >> "$INAD_HOME/calls"
case "$4" in
  eligible) if [ "$5" = com.openai.codex ]; then echo ok; else echo skipped; fi ;;
  front) echo skipped ;;
  place) echo 20,20 ;;
esac`);
  shim('open', 'echo "OPEN $1 $2" >> "$INAD_HOME/calls"; touch "$INAD_HOME/launched"');
  const calls = () => readFileSync(join(dir, 'calls'), 'utf8');
  function launch(args: string[], existing = false) {
    const result = spawnSync('/bin/sh', [resolve('plugin/scripts/open.sh'), ...args], { encoding: 'utf8', timeout: 3000,
      env: { NODE_ENV: 'test', PATH: dir + ':/usr/bin:/bin', INAD_HOME: dir, MOCK_PID: existing ? 'running' : 'closed' } });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    return calls();
  }
  return { dir, calls, launch };
}

test('an existing Mac popup that declined focus is never reopened; background sends cannot raise it', (t) => {
  const { launch } = launcher(t);
  assert.equal(launch(['--background'], true), '');
  const calls = launch(['--resurface', origin, 'first'], true);
  assert.match(calls, /front 123 now com\.openai\.codex/);
  assert.doesNotMatch(calls, /OPEN/);
});

test('ordinary-tab fallback opens in the background on the first eligible Mac prompt only', (t) => {
  const { dir, launch } = launcher(t);
  writeFileSync(join(dir, 'no-popup'), '');
  assert.equal(launch(['--resurface', origin]), '');
  assert.doesNotMatch(launch(['--resurface', 'com.example.unrelated', 'first']), /OPEN/);
  assert.match(launch(['--resurface', origin, 'first']), /OPEN -g https:/);
});

test('a new Mac popup launches in the background and passes its origin to the eventual raise', async (t) => {
  const names = ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Chromium'];
  if (!names.some(name => [join('/Applications', name + '.app'), join(homedir(), 'Applications', name + '.app')].some(existsSync))) {
    t.skip('launcher platform fixture requires an installed Mac Chromium browser');
    return;
  }
  const { launch, calls } = launcher(t);
  assert.doesNotMatch(launch(['--resurface', 'com.example.unrelated']), /OPEN/);
  assert.match(launch(['--resurface', origin]), /OPEN -g -na/);
  for (let i = 0; i < 50 && !calls().includes('front'); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(calls(), /front 123 wait com\.openai\.codex/);
});
