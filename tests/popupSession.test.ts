import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_TOKEN_KEY, initializeArcadePairing, prefersPopupClips, rememberPopupClips } from '../app/arcade/popupSession';
import { readAgentToken, updateAgentQueue } from '../app/games/engine/useAgentSync';

const first = 'first-test-pairing-for-distraction';
const second = 'second-test-pairing-for-distraction';
const launch = (token: string) => new URLSearchParams({ t: token, popup: '' });
const clean = new URLSearchParams();

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function browser(t: TestContext, mode: string) {
  const local = storage();
  const view = {
    mode, top: null as unknown, opener: null as unknown,
    matchMedia(query: string) { return { matches: query.includes(`(display-mode: ${this.mode})`) }; },
    sessionStorage: storage(),
    dispatchEvent: () => true,
  };
  view.top = view;
  for (const [key, value] of Object.entries({ window: view, localStorage: local })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  return { view, local };
}

test('a dedicated launch stores only a window pairing and retains it across reload', (t) => {
  const { view, local } = browser(t, 'standalone');
  assert.deepEqual(initializeArcadePairing(clean), { popup: false });
  assert.deepEqual(initializeArcadePairing(launch(first)), { popup: true });
  assert.deepEqual(initializeArcadePairing(clean), { popup: true });
  assert.equal(readAgentToken(), first);
  assert.deepEqual([...view.sessionStorage.values.values()], [first]);
  assert.equal(local.values.size, 0);
});

test('cross-window re-pairing leaves the popup queue, settings reader and return target bound to its own agent', async (t) => {
  const { local } = browser(t, 'minimal-ui');
  local.setItem(AGENT_TOKEN_KEY, second);
  initializeArcadePairing(launch(first));
  assert.equal(local.getItem(AGENT_TOKEN_KEY), second, 'preserve other tabs');
  local.removeItem(AGENT_TOKEN_KEY);
  assert.equal(readAgentToken(), first);
  local.setItem(AGENT_TOKEN_KEY, second);
  assert.deepEqual(initializeArcadePairing(clean), { popup: true });
  assert.equal(readAgentToken(), first);
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, `/api/agent/${first}`);
    return Response.json({ seq: 1 });
  });
  await updateAgentQueue('ack', { run: 'one', revision: 1 });
});

test('a normal tab ignores an inherited popup credential and saves a copied launch as a browser pairing', (t) => {
  const { view, local } = browser(t, 'standalone');
  initializeArcadePairing(launch(first));
  view.mode = 'browser';
  assert.deepEqual(initializeArcadePairing(clean), { popup: false });
  assert.equal(readAgentToken(), null);
  assert.deepEqual(initializeArcadePairing(launch(second)), { popup: false });
  assert.equal(readAgentToken(), second);
  assert.equal(local.getItem(AGENT_TOKEN_KEY), second);
});

test('a clip choice survives a fresh popup launch until the user returns to games', (t) => {
  const { view } = browser(t, 'standalone');
  initializeArcadePairing(launch(first));
  assert.equal(prefersPopupClips(), false);
  rememberPopupClips(true);
  view.sessionStorage = storage();
  assert.equal(prefersPopupClips(), false, 'a locally saved choice alone cannot enable clips');
  initializeArcadePairing(launch(first));
  assert.equal(prefersPopupClips(), true);
  rememberPopupClips(false);
  initializeArcadePairing(clean);
  assert.equal(prefersPopupClips(), false);
});

test('opening directly into clips requires a valid dedicated launch and cannot opt in an ordinary tab', (t) => {
  const { view } = browser(t, 'browser');
  const direct = new URLSearchParams({ t: first, mode: 'clips', popup: '' });
  initializeArcadePairing(direct);
  rememberPopupClips(true);
  view.mode = 'standalone';
  initializeArcadePairing(launch(first));
  assert.equal(prefersPopupClips(), false, 'a prior visit in a tab did not change the choice');
  initializeArcadePairing(direct);
  assert.equal(prefersPopupClips(), true);
  view.mode = 'browser';
  assert.equal(prefersPopupClips(), false);
});

test('legacy app windows and fresh unmarked links retain the profile-wide pairing', (t) => {
  const { view, local } = browser(t, 'standalone');
  local.setItem(AGENT_TOKEN_KEY, first);
  assert.deepEqual(initializeArcadePairing(clean), { popup: false });
  assert.equal(readAgentToken(), first);
  initializeArcadePairing(launch(first));
  assert.deepEqual(initializeArcadePairing(new URLSearchParams({ t: second })), { popup: false });
  assert.equal(view.sessionStorage.values.size, 0);
  assert.deepEqual(initializeArcadePairing(clean), { popup: false });
  assert.equal(readAgentToken(), second);
});

test('invalid or incomplete fresh app links cannot reclaim a prior window or browser pairing on reload', (t) => {
  const { local } = browser(t, 'standalone');
  local.setItem(AGENT_TOKEN_KEY, second);
  for (const fragment of ['popup', 't=', 't=bad&popup', `t=${first}&t=${second}&popup`]) {
    initializeArcadePairing(launch(first));
    assert.deepEqual(initializeArcadePairing(new URLSearchParams(fragment)), { popup: false, error: 'invalid' });
    assert.equal(readAgentToken(), null);
    assert.deepEqual(initializeArcadePairing(clean), { popup: false, error: 'invalid' });
    assert.equal(local.getItem(AGENT_TOKEN_KEY), second);
  }
});

test('a fresh app pairing that cannot be persisted is an error even if its token matches profile storage', (t) => {
  const { view, local } = browser(t, 'standalone');
  local.setItem(AGENT_TOKEN_KEY, first);
  view.sessionStorage.setItem = () => {};
  assert.deepEqual(initializeArcadePairing(launch(first)), { popup: false, error: 'storage' });
});

test('frames and opener windows always read the browser pairing instead of an inherited popup credential', (t) => {
  const { view, local } = browser(t, 'standalone');
  initializeArcadePairing(launch(first));
  local.setItem(AGENT_TOKEN_KEY, second);
  view.opener = {};
  assert.equal(readAgentToken(), second);
  assert.deepEqual(initializeArcadePairing(clean), { popup: false });
  view.opener = null;
  view.top = {};
  assert.equal(readAgentToken(), second);
  assert.deepEqual(initializeArcadePairing(launch(first)), { popup: false });
});
