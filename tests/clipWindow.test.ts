import { strict as assert } from 'node:assert';
import { test, type TestContext } from 'node:test';
import { enterClipWindow, positionGamePopup, restoreClipWindow } from '../app/arcade/clipWindow';

function testWindow(t: TestContext) {
  const memory = new Map<string, string>();
  const view = {
    screenX: -580, screenY: 120, outerWidth: 475, outerHeight: 714,
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
  assert.equal(enterClipWindow(false), undefined);
  assert.deepEqual(bounds(), before);
  assert.equal(memory.size, 0);
});

test('clips fill the current monitor work area and return to the exact game bounds after reload', (t) => {
  const { bounds, memory } = testWindow(t);
  const before = bounds();
  enterClipWindow(true);
  assert.deepEqual(bounds(), [-1422, 56, 1404, 864]);
  const restoreAfterReload = enterClipWindow(true);
  restoreAfterReload?.();
  assert.deepEqual(bounds(), before);
  assert.equal(memory.size, 0);
});

test('a fresh compact launch uses the right edge of the current monitor', (t) => {
  const { bounds, view } = testWindow(t);
  positionGamePopup();
  assert.deepEqual(bounds(), [-484, 88, 460, 800]);
  view.screen.availWidth = 420;
  view.screen.availHeight = 640;
  positionGamePopup();
  assert.deepEqual(bounds(), [-1440, 38, 420, 640]);
});

test('Stop, Keep, and entering Off on reload preserve the original game bounds', (t) => {
  const { bounds, memory } = testWindow(t);
  const original = bounds();
  const stop = enterClipWindow(true);
  const enlarged = bounds();
  stop?.();
  assert.deepEqual(bounds(), original);
  enterClipWindow(true);
  assert.deepEqual(bounds(), enlarged);
  restoreClipWindow();
  assert.deepEqual(bounds(), original);
  assert.equal(memory.size, 0);
  restoreClipWindow();
  assert.deepEqual(bounds(), original);
});
