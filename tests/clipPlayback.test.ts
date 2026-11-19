import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { FAMILY_GUY_CLIPS, shuffledClips } from '../app/arcade/clips/catalog';
import { mountClipPlayer, type YouTubeApi } from '../app/arcade/clips/youtube';

type Hooks = ConstructorParameters<YouTubeApi['Player']>[1]['events'];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture(t: TestContext) {
  const added: string[] = [];
  const fakeHost = {
    isConnected: true,
    children: [] as { src: string }[],
    append(child: { src: string }) { this.children.push(child); },
  };
  const view = { hidden: false, createElement: () => ({
    src: '',
    remove() { fakeHost.children = fakeHost.children.filter((child) => child !== this); },
  }) };
  for (const [key, value] of [['document', view], ['window', { location: { origin: 'https://game.example' } }]] as const) {
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
    constructor(_frame: unknown, options: { events: Hooks }) { hooks = options.events; realPlayer = this; added.push('create'); }
    playVideo() { added.push('play'); }
    pauseVideo() { added.push('pause'); }
    destroy() { added.push('destroy'); }
    mute() { added.push('mute'); }
    unMute() { added.push('unmute'); }
    getCurrentTime() { return 11.5; }
  }
  let resolveApi!: (api: YouTubeApi) => void;
  const pending = new Promise<YouTubeApi>((resolve) => { resolveApi = resolve; });
  const start = (seconds = 0) => {
    const session = mountClipPlayer(fakeHost as unknown as HTMLDivElement, FAMILY_GUY_CLIPS[0], { start: seconds, sound: false }, {
      onPlaying: () => added.push('playing'), onPressPlay: () => added.push('pressPlay'),
      onEnded: () => added.push('ended'), onUnavailable: () => added.push('skip'), onFailure: () => added.push('error'),
    }, () => pending);
    t.after(() => session.stop());
    return session;
  };
  return { view, fakeHost, added, start, load: async () => { resolveApi({ Player: StubPlayer }); await flush(); },
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

test('an interruption stops a playing clip; explicit resume creates a new frame at the bookmark', async (t) => {
  const f = fixture(t);
  const first = f.start();
  await f.load();
  const old = f.hooks();
  old.onReady(f.event());
  old.onStateChange(f.event(1));
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
  resume.stop();
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

test('each shuffle includes the three official clips and avoids an immediate repeat across collections', () => {
  for (const clip of FAMILY_GUY_CLIPS) {
    const batch = shuffledClips(clip.id);
    assert.notEqual(batch[0].id, clip.id);
    assert.deepEqual(new Set(batch.map((c) => c.id)), new Set(FAMILY_GUY_CLIPS.map((c) => c.id)));
  }
});

test('a blocked clip stays excluded while the two remaining clips alternate across shuffles', () => {
  const [previous, other, blocked] = FAMILY_GUY_CLIPS;
  const unavailable = new Set([blocked.id]);
  assert.deepEqual(shuffledClips(previous.id, unavailable), [other, previous]);
  unavailable.add(other.id);
  assert.deepEqual(shuffledClips(previous.id, unavailable), [previous]);
  unavailable.add(previous.id);
  assert.deepEqual(shuffledClips(previous.id, unavailable), []);
});
