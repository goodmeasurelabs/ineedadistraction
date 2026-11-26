import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { onPopupRefocus } from '../app/arcade/clipWindow';
import { FAMILY_GUY_CLIPS } from '../app/arcade/clips/catalog';
import { mountClipPlayer, playWhileVisible, type ClipAudio, type YouTubeApi } from '../app/arcade/clips/youtube';

type Hooks = ConstructorParameters<YouTubeApi['Player']>[1]['events'];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture(t: TestContext, sound = false) {
  const sessions: ReturnType<typeof mountClipPlayer>[] = [];
  t.after(() => { for (const session of sessions) session.stop(); });
  const audio: ClipAudio = { sound };
  const added: string[] = [];
  const fakeHost = {
    isConnected: true,
    children: [] as { src: string }[],
    append(child: { src: string }) { this.children.push(child); },
  };
  const view = Object.assign(new EventTarget(), { hidden: false, focused: true, hasFocus() { return this.focused; }, createElement: () => ({
    src: '',
    remove() { fakeHost.children = fakeHost.children.filter((child) => child !== this); },
  }) });
  const userActivation = { hasBeenActive: false };
  const browser = Object.assign(new EventTarget(), { location: { origin: 'https://game.example' }, navigator: { userActivation } });
  for (const [key, value] of [['document', view], ['window', browser]] as const) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (before) Object.defineProperty(globalThis, key, before);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  let hooks: Hooks;
  let realPlayer: StubPlayer;
  class StubPlayer {
    private muted = false;
    private volume = 100;
    constructor(_frame: unknown, options: { events: Hooks }) { hooks = options.events; realPlayer = this; added.push('create'); }
    playVideo() { added.push('play'); }
    pauseVideo() { added.push('pause'); }
    destroy() { added.push('destroy'); }
    mute() { this.muted = true; added.push('mute'); }
    unMute() { this.muted = false; added.push('unmute'); }
    isMuted() { return this.muted; }
    getVolume() { return this.volume; }
    setVolume(volume: number) { this.volume = volume; }
    getCurrentTime() { return 11.5; }
  }
  let resolveApi!: (api: YouTubeApi) => void;
  const pending = new Promise<YouTubeApi>((resolve) => { resolveApi = resolve; });
  const start = (seconds = 0, clip = FAMILY_GUY_CLIPS[0], onFocusLost?: () => void) => {
    const session = mountClipPlayer(fakeHost as unknown as HTMLDivElement, clip, { start: seconds, audio, onFocusLost }, {
      onPlaying: () => added.push('playing'), onPressPlay: () => added.push('pressPlay'),
      onEnded: () => added.push('ended'), onUnavailable: () => added.push('skip'), onFailure: () => added.push('error'),
    }, () => pending);
    sessions.push(session);
    return session;
  };
  return { audio, view, browser, userActivation, fakeHost, added, start, player: () => realPlayer, load: async () => { resolveApi({ Player: StubPlayer }); await flush(); },
    hooks: () => hooks, event: (data = 0) => ({ target: realPlayer, data }),
  };
}

test('Stop while the YouTube SDK loads never constructs a player after the SDK resolves', async (t) => {
  const f = fixture(t);
  const session = f.start();
  session.stop();
  await f.load();
  assert.deepEqual(f.fakeHost.children, []);
  assert.deepEqual(f.added, []);
});

test('Stop during iframe loading revokes every callback including ready, playing, ended and embed errors', async (t) => {
  const f = fixture(t);
  const session = f.start();
  await f.load();
  assert.equal(f.fakeHost.children.length, 1);
  const old = f.hooks();
  session.stop();
  old.onReady(f.event()); old.onStateChange(f.event(1)); old.onStateChange(f.event(0));
  old.onAutoplayBlocked(f.event()); old.onError(f.event(150));
  assert.deepEqual(f.fakeHost.children, []);
  assert.deepEqual(f.added, ['create', 'pause', 'destroy']);
});

test('player cleanup preserves replacement controls React rendered into the host', async (t) => {
  const f = fixture(t);
  const session = f.start();
  await f.load();
  const pausedControls = { src: 'local:paused-controls' };
  f.fakeHost.append(pausedControls);
  session.stop();
  assert.deepEqual(f.fakeHost.children, [pausedControls]);
});

test('an interruption stops a playing clip and the next player starts automatically at the bookmark', async (t) => {
  const f = fixture(t);
  const first = f.start();
  await f.load();
  const old = f.hooks();
  old.onReady(f.event());
  old.onStateChange(f.event(1));
  f.player().unMute();
  f.player().setVolume(41);
  assert.ok(f.added.includes('play'));
  const at = first.stop();
  assert.ok(at > 0);
  assert.equal(f.fakeHost.children.length, 0);
  const resume = f.start(at);
  await flush();
  const url = new URL(f.fakeHost.children[0].src);
  assert.equal(url.origin, 'https://www.youtube-nocookie.com');
  assert.equal(url.searchParams.get('origin'), 'https://game.example');
  assert.equal(url.searchParams.get('start'), '11');
  assert.equal(url.searchParams.get('autoplay'), '0');
  old.onReady(f.event()); old.onStateChange(f.event(0));
  assert.equal(f.added.filter((action) => action === 'play').length, 1);
  assert.ok(!f.added.includes('ended'));
  f.hooks().onReady(f.event());
  assert.equal(f.added.filter((action) => action === 'play').length, 2);
  assert.equal(f.player().isMuted(), false);
  assert.equal(f.player().getVolume(), 41);
  resume.stop();
});

function observePlayer(t: TestContext) {
  let report!: (entries: { intersectionRatio: number }[]) => void;
  class Observer {
    constructor(callback: typeof report) { report = callback; }
    observe() {}
    disconnect() {}
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: Observer });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'IntersectionObserver', previous);
    else Reflect.deleteProperty(globalThis, 'IntersectionObserver');
  });
  return (intersectionRatio: number) => report([{ intersectionRatio }]);
}

test('playback follows popup visibility and ignores queued visibility events after Stop', async (t) => {
  const f = fixture(t);
  const report = observePlayer(t);
  let bookmark = 0;
  f.view.hidden = true;
  const stop = playWhileVisible(f.fakeHost as unknown as HTMLElement, () => {
    const session = f.start(bookmark);
    return () => { bookmark = session.stop(); };
  });
  t.after(stop);
  await f.load();
  report(1);
  assert.equal(f.added.length, 0);

  f.view.hidden = false;
  f.view.dispatchEvent(new Event('visibilitychange'));
  await flush();
  f.hooks().onReady(f.event());
  assert.equal(f.added.at(-1), 'play');
  report(0.2);
  assert.equal(f.fakeHost.children.length, 0);
  report(1);
  await flush();
  assert.equal(new URL(f.fakeHost.children[0].src).searchParams.get('start'), '11');

  f.browser.dispatchEvent(new Event('pagehide'));
  assert.equal(f.fakeHost.children.length, 0);
  f.browser.dispatchEvent(new Event('pageshow'));
  await flush();
  assert.equal(f.fakeHost.children.length, 1);
  stop();
  report(1);
  f.browser.dispatchEvent(new Event('pageshow'));
  f.view.dispatchEvent(new Event('visibilitychange'));
  await flush();
  assert.equal(f.fakeHost.children.length, 0);
});

test('an unfocused visible popup stays quiet through SDK loading and focus restoration', async (t) => {
  const f = fixture(t, true);
  const report = observePlayer(t);
  f.view.focused = false;
  const stop = playWhileVisible(f.fakeHost as unknown as HTMLElement, () => {
    const session = f.start();
    return () => { session.stop(); };
  }, () => { f.audio.sound = false; });
  try {
    report(1);
    assert.equal(f.audio.sound, false, 'losing focus disarms sound even before a player exists');
    await f.load();
    assert.deepEqual(f.fakeHost.children, []);
    f.view.focused = true;
    f.browser.dispatchEvent(new Event('focus'));
    await flush();
    f.hooks().onReady(f.event());
    assert.deepEqual(f.added, ['create', 'mute', 'play']);
    f.hooks().onStateChange(f.event(1));
    f.player().unMute();
  } finally { stop(); }
  assert.equal(f.audio.sound, true, 'ordinary replacement keeps the native unmute');
});

test('switching apps stops a visible clip on blur and resumes its bookmark quietly', async (t) => {
  const f = fixture(t, true);
  const report = observePlayer(t);
  let bookmark = 0;
  const stop = playWhileVisible(f.fakeHost as unknown as HTMLElement, () => {
    const session = f.start(bookmark);
    return () => { bookmark = session.stop(); };
  }, () => { f.audio.sound = false; });
  try {
    report(1);
    await f.load();
    const old = f.hooks();
    old.onReady(f.event());
    old.onStateChange(f.event(1));
    f.player().setVolume(46);
    assert.equal(f.player().isMuted(), false);

    f.view.focused = false;
    f.browser.dispatchEvent(new Event('blur'));
    assert.equal(f.fakeHost.children.length, 0);
    assert.deepEqual(f.audio, { sound: false, volume: 46 });
    const stopped = [...f.added];
    old.onReady(f.event()); old.onAutoplayBlocked(f.event()); old.onStateChange(f.event(0)); old.onError(f.event(150));
    report(1);
    assert.deepEqual(f.added, stopped);

    f.view.focused = true;
    f.browser.dispatchEvent(new Event('focus'));
    await flush();
    assert.equal(new URL(f.fakeHost.children[0].src).searchParams.get('start'), '11');
    f.hooks().onReady(f.event());
    assert.equal(f.player().isMuted(), true);
    assert.equal(f.player().getVolume(), 46);
  } finally { stop(); }
});

test('Back to Codex holds the bookmarked clip until the popup actually leaves and returns', async (t) => {
  const f = fixture(t);
  const playing = f.start();
  await f.load();
  const old = f.hooks();
  old.onReady(f.event());
  old.onStateChange(f.event(1));
  const original = new URL(f.fakeHost.children[0].src);
  const bookmark = playing.stop();
  const cancel = onPopupRefocus(() => { f.start(bookmark); });

  const stopped = [...f.added];
  // A delayed focus request leaves the old popup visible and focused. Chromium
  // can also dispatch blur when focus moves between the page and its iframe.
  f.browser.dispatchEvent(new Event('blur'));
  f.browser.dispatchEvent(new Event('focus'));
  old.onStateChange(f.event(0));
  old.onError(f.event(150));
  await flush();
  assert.equal(f.fakeHost.children.length, 0);
  assert.deepEqual(f.added, stopped);

  f.view.focused = false;
  f.browser.dispatchEvent(new Event('blur'));
  old.onReady(f.event());
  old.onStateChange(f.event(0));
  f.view.dispatchEvent(new Event('visibilitychange'));
  await flush();
  assert.deepEqual(f.added, stopped);

  f.view.focused = true;
  f.browser.dispatchEvent(new Event('focus'));
  f.view.dispatchEvent(new Event('visibilitychange'));
  await flush();
  cancel();
  assert.equal(f.fakeHost.children.length, 1);
  const resumed = new URL(f.fakeHost.children[0].src);
  assert.equal(resumed.pathname, original.pathname);
  assert.equal(resumed.searchParams.get('start'), '11');
  f.hooks().onReady(f.event());
  assert.deepEqual(f.added.slice(stopped.length), ['create', 'mute', 'play']);
});

test('explicit Play after a failed handoff removes the pending automatic resume', async (t) => {
  const f = fixture(t);
  const automaticResume = t.mock.fn();
  const cancel = onPopupRefocus(automaticResume);
  cancel();
  f.start();
  await f.load();
  f.hooks().onReady(f.event());
  f.view.hidden = true;
  f.view.dispatchEvent(new Event('visibilitychange'));
  f.view.hidden = false;
  f.view.dispatchEvent(new Event('visibilitychange'));
  assert.equal(automaticResume.mock.callCount(), 0);
  assert.deepEqual(f.added, ['create', 'mute', 'play']);
});

test('switching apps while the SDK loads cancels the pending player before it can create a frame', async (t) => {
  const f = fixture(t, true);
  const report = observePlayer(t);
  const stop = playWhileVisible(f.fakeHost as unknown as HTMLElement, () => f.start().stop, () => { f.audio.sound = false; });
  try {
    report(1);
    f.view.focused = false;
    f.browser.dispatchEvent(new Event('blur'));
    await f.load();
    assert.deepEqual(f.added, []);
    assert.deepEqual(f.fakeHost.children, []);
    assert.equal(f.audio.sound, false);
  } finally { stop(); }
});

for (const stage of ['SDK', 'iframe'] as const) {
  test(`a ${stage} ready callback during brief focus loss retries on return before the fallback timer runs`, async (t) => {
    const f = fixture(t, true);
    const report = observePlayer(t);
    const stop = playWhileVisible(f.fakeHost as unknown as HTMLElement,
      (onFocusLost) => f.start(0, undefined, onFocusLost).stop, () => { f.audio.sound = false; });
    try {
      report(1);
      if (stage === 'iframe') await f.load();
      f.view.focused = false;
      if (stage === 'SDK') await f.load();
      else f.hooks().onReady(f.event());
      assert.equal(f.audio.sound, false);
      assert.equal(f.fakeHost.children.length, 0);
      f.view.focused = true;
      f.browser.dispatchEvent(new Event('focus'));
      await flush();
      f.hooks().onReady(f.event());
      assert.equal(f.fakeHost.children.length, 1);
      assert.equal(f.player().isMuted(), true);
      assert.equal(f.added.at(-1), 'play');
    } finally { stop(); }
  });
}

test('native controls retain focus inside the popup, then a missed app blur releases the embed', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = fixture(t, true);
  const report = observePlayer(t);
  let session: ReturnType<typeof f.start>;
  const stop = playWhileVisible(f.fakeHost as unknown as HTMLElement, () => {
    session = f.start();
    return session.stop;
  }, () => { f.audio.sound = false; });
  try {
    report(1);
    await f.load();
    f.hooks().onReady(f.event());
    f.hooks().onStateChange(f.event(1));
    // Chromium fires top-window blur as focus moves into a cross-origin child.
    f.browser.dispatchEvent(new Event('blur'));
    t.mock.timers.tick(250);
    assert.equal(f.fakeHost.children.length, 1);
    assert.equal(f.audio.sound, true);
    f.view.focused = false;
    const before = [...f.added];
    f.hooks().onReady(f.event()); f.hooks().onAutoplayBlocked(f.event());
    f.hooks().onStateChange(f.event(0)); f.hooks().onError(f.event(150));
    session!.setSound(true);
    assert.deepEqual(f.added, before, 'callbacks cannot restart, rotate, or unmute an unfocused clip');
    t.mock.timers.tick(250);
    assert.equal(f.fakeHost.children.length, 0);
    assert.equal(f.audio.sound, false);
  } finally { stop(); }
});

test('a focused native player hands focus back to the popup before natural clip replacement', async (t) => {
  const f = fixture(t);
  const host = Object.assign(f.fakeHost, {
    tabIndex: 0,
    focus({ preventScroll }: FocusOptions) {
      assert.equal(preventScroll, true);
      f.added.push('focus-host');
    },
  });
  f.start();
  await f.load();
  Object.assign(f.view, { activeElement: host.children[0] });
  f.hooks().onReady(f.event());
  f.hooks().onStateChange(f.event(1));
  f.hooks().onStateChange(f.event(0));
  assert.equal(host.tabIndex, -1);
  assert.deepEqual(f.added.slice(-4), ['focus-host', 'pause', 'destroy', 'ended']);

  const next = f.start();
  await flush();
  Object.assign(f.view, { activeElement: host.children[0], focused: false });
  next.stop();
  assert.equal(f.added.filter((action) => action === 'focus-host').length, 1);
});

test('a quiet session starts silently even with an earlier document interaction and saved volume', async (t) => {
  const f = fixture(t);
  f.userActivation.hasBeenActive = true;
  f.audio.volume = 63;
  f.start();
  await f.load();
  f.hooks().onReady(f.event());
  assert.deepEqual(f.added, ['create', 'mute', 'play']);
  f.hooks().onStateChange(f.event(1));
  assert.deepEqual(f.added, ['create', 'mute', 'play', 'playing']);
});

test('an audible start blocked by the browser retries muted before asking for native Play', async (t) => {
  const f = fixture(t, true);
  f.userActivation.hasBeenActive = true;
  f.start();
  await f.load();
  f.hooks().onReady(f.event());
  f.hooks().onAutoplayBlocked(f.event());
  assert.deepEqual(f.added, ['create', 'unmute', 'play', 'mute', 'play']);
  f.hooks().onAutoplayBlocked(f.event());
  assert.equal(f.added.at(-1), 'pressPlay');
});

test('unmuting in YouTube carries the chosen volume to the next clip on natural completion', async (t) => {
  const f = fixture(t);
  f.start();
  await f.load();
  f.hooks().onReady(f.event());
  assert.equal(f.player().isMuted(), true);
  f.hooks().onStateChange(f.event(1));
  f.player().unMute();
  f.player().setVolume(37);
  f.hooks().onStateChange(f.event(0));
  assert.equal(f.added.at(-1), 'ended');

  f.start(0, FAMILY_GUY_CLIPS[1]);
  await flush();
  f.hooks().onReady(f.event());
  assert.equal(f.player().isMuted(), false);
  assert.equal(f.player().getVolume(), 37);
  assert.equal(f.added.at(-1), 'play');
});

test('manual skip carries a native mute independently from the volume slider, including zero', async (t) => {
  const f = fixture(t, true);
  f.userActivation.hasBeenActive = true;
  const first = f.start();
  await f.load();
  f.hooks().onReady(f.event());
  f.hooks().onStateChange(f.event(1));
  f.player().setVolume(57);
  f.player().mute();
  first.stop();

  const next = f.start(0, FAMILY_GUY_CLIPS[1]);
  await flush();
  f.hooks().onReady(f.event());
  assert.equal(f.player().isMuted(), true);
  assert.equal(f.player().getVolume(), 57);
  f.hooks().onStateChange(f.event(1));
  f.player().unMute();
  f.player().setVolume(0);
  next.stop();

  f.start(0, FAMILY_GUY_CLIPS[2]);
  await flush();
  f.hooks().onReady(f.event());
  assert.equal(f.player().isMuted(), false);
  assert.equal(f.player().getVolume(), 0);
});

test('an embed that fails before playing and its late callbacks preserve the previous clip’s audio', async (t) => {
  const f = fixture(t, true);
  f.audio.volume = 24;
  const failed = f.start();
  await f.load();
  const old = f.hooks();
  const target = f.player();
  old.onReady(f.event());
  target.mute();
  target.setVolume(0);
  old.onError(f.event(150));
  assert.deepEqual(f.audio, { sound: true, volume: 24 });

  f.start(0, FAMILY_GUY_CLIPS[1]);
  await flush();
  f.hooks().onReady(f.event());
  old.onStateChange({ target, data: 1 });
  old.onStateChange({ target, data: 0 });
  failed.stop();
  failed.setSound(false);
  assert.deepEqual(f.audio, { sound: true, volume: 24 });
  assert.equal(f.player().isMuted(), false);
  assert.equal(f.player().getVolume(), 24);
});

test('a browser-required muted retry keeps the next clip muted until the viewer unmutes', async (t) => {
  const f = fixture(t, true);
  f.audio.volume = 63;
  f.start();
  await f.load();
  f.hooks().onReady(f.event());
  assert.equal(f.player().isMuted(), false);
  f.hooks().onAutoplayBlocked(f.event());
  assert.equal(f.player().isMuted(), true);
  f.hooks().onStateChange(f.event(1));
  f.hooks().onStateChange(f.event(0));

  f.start(0, FAMILY_GUY_CLIPS[1]);
  await flush();
  f.hooks().onReady(f.event());
  assert.equal(f.player().isMuted(), true);
  assert.equal(f.player().getVolume(), 63);
  assert.equal(f.added.at(-1), 'play');
});

test('a hidden window cannot start playback or schedule another clip', async (t) => {
  const f = fixture(t);
  f.start(); await f.load();
  f.view.hidden = true;
  f.hooks().onReady(f.event()); f.hooks().onStateChange(f.event(0));
  assert.deepEqual(f.added, ['create']);
});

for (const [code, action] of [[150, 'skip'], [153, 'error']] as const) {
  test(`YouTube error ${code} settles once even if a later end event arrives`, async (t) => {
    const f = fixture(t);
    f.start(); await f.load();
    f.hooks().onError(f.event(code)); f.hooks().onStateChange(f.event(0)); f.hooks().onError(f.event(code));
    assert.deepEqual(f.added, ['create', 'pause', 'destroy', action]);
  });
}
