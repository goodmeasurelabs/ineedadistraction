import { strict as assert } from 'node:assert';
import { test, type TestContext } from 'node:test';
import { initializePopupWindow } from '../app/arcade/clipWindow';

const legacyKey = 'inad:game-window-bounds:v1';
const saved = { left: -580, top: 120, width: 475, height: 714 };
const fresh = { popup: true, freshLaunch: true };
const reload = { popup: true, freshLaunch: false };

function testWindow(t: TestContext) {
  const memory = new Map<string, string>();
  const view = {
    screenX: saved.left, screenY: saved.top, outerWidth: saved.width, outerHeight: saved.height,
    screen: { availLeft: -1440, availTop: 38, availWidth: 1440, availHeight: 900 },
    sessionStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
    },
    resizeTo(width: number, height: number) { this.outerWidth = width; this.outerHeight = height; },
    moveTo(left: number, top: number) { this.screenX = left; this.screenY = top; },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: view, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  return { view, memory, bounds: () => [view.screenX, view.screenY, view.outerWidth, view.outerHeight] };
}

test('a regular browser tab keeps its geometry and storage', (t) => {
  const { bounds, memory } = testWindow(t);
  const before = bounds();
  memory.set(legacyKey, JSON.stringify(saved));
  initializePopupWindow({ popup: false, freshLaunch: true });
  assert.deepEqual(bounds(), before);
  assert.equal(memory.has(legacyKey), true);
});

test('a fresh compact launch uses the right edge of the current monitor', (t) => {
  const { bounds, view } = testWindow(t);
  initializePopupWindow(fresh);
  assert.deepEqual(bounds(), [-484, 88, 460, 800]);
  view.screen.availWidth = 420;
  view.screen.availHeight = 640;
  initializePopupWindow(fresh);
  assert.deepEqual(bounds(), [-1440, 38, 420, 640]);
});

test('reload restores the original size of a popup expanded by the previous release just once', (t) => {
  const { bounds, memory, view } = testWindow(t);
  const original = bounds();
  memory.set(legacyKey, JSON.stringify(saved));
  view.moveTo(-1422, 56);
  view.resizeTo(1404, 864);
  initializePopupWindow(reload);
  assert.deepEqual(bounds(), original);
  assert.equal(memory.size, 0);
  view.resizeTo(780, 600);
  initializePopupWindow(reload);
  assert.deepEqual(bounds(), [-580, 120, 780, 600]);
});

test('an already adjusted legacy popup keeps the user’s size and position on reload', (t) => {
  const { bounds, memory, view } = testWindow(t);
  memory.set(legacyKey, JSON.stringify(saved));
  view.moveTo(-1200, 75);
  view.resizeTo(720, 680);
  initializePopupWindow(reload);
  assert.deepEqual(bounds(), [-1200, 75, 720, 680]);
  assert.equal(memory.size, 0);
});

test('a manually sized popup keeps its dimensions after a clean reload', (t) => {
  const { bounds, view } = testWindow(t);
  initializePopupWindow(fresh);
  view.moveTo(-1000, 60);
  view.resizeTo(880, 700);
  initializePopupWindow(reload);
  assert.deepEqual(bounds(), [-1000, 60, 880, 700]);
});

test('invalid legacy data is discarded without moving a window', (t) => {
  const { bounds, memory } = testWindow(t);
  const original = bounds();
  memory.set(legacyKey, 'null');
  initializePopupWindow(reload);
  assert.equal(memory.size, 0);
  assert.deepEqual(bounds(), original);
});
