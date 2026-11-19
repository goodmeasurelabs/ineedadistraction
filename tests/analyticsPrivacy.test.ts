import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { trackEvent } from '../app/lib/analytics';

const initialWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const token = 'private-pairing-capability-123456789';
const site = 'https://www.ineedadistraction.com';

afterEach(() => {
  if (initialWindow) Object.defineProperty(globalThis, 'window', initialWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('pairing analytics exclude the fragment before the player consumes it', () => {
  const calls: unknown[][] = [];
  const browser = {
    location: new URL(`${site}/arcade?game=tessel#t=${token}&popup`),
    gtag: (...args: unknown[]) => calls.push(args),
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });

  trackEvent('agent_pairing_link_opened', {});
  assert.deepEqual(calls, [['event', 'agent_pairing_link_opened', {
    page_location: `${site}/arcade?game=tessel`,
  }]]);
  assert.equal(JSON.stringify(calls).includes(token), false);
});

test('each event uses the current sanitized location and overrides a caller URL', () => {
  const calls: unknown[][] = [];
  const browser = {
    location: new URL(`${site}/agent#t=${token}`),
    gtag: (...args: unknown[]) => calls.push(args),
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  const params = { categories: 'logic,math', page_location: browser.location.href };

  trackEvent('distraction_preferences_saved', params);
  browser.location = new URL(`${site}/games/tessel?mode=classic#t=${token}`);
  trackEvent('game_start', { game_id: 'tessel' });

  assert.equal((calls[0][2] as Record<string, unknown>).page_location, `${site}/agent`);
  assert.deepEqual(calls[1], ['event', 'game_start', {
    game_id: 'tessel', page_location: `${site}/games/tessel?mode=classic`,
  }]);
  assert.equal(params.page_location, `${site}/agent#t=${token}`);
  assert.equal(JSON.stringify(calls).includes(token), false);
});

test('the actual initial GA bootstrap excludes a pairing fragment from its config', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  const bootstrap = layout.match(/<Script id="ga-init"[^>]*>\{`([\s\S]*?)`\}<\/Script>/)?.[1];
  assert.ok(bootstrap, 'The layout must expose its GA initialization script');
  const stored = new Map<string, string>();
  const browser: Record<string, unknown> = {
    location: new URL(`${site}/agent?notrack=1#t=${token}&popup`),
    URLSearchParams,
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  };
  browser.window = browser;
  runInNewContext(bootstrap.replaceAll('${GA_ID}', 'G-PRIVACY'), browser);
  const calls = (browser.dataLayer as IArguments[]).map((args) => Array.from(args));
  const config = calls.find((call) => call[0] === 'config');

  assert.ok(config);
  assert.equal((config[2] as Record<string, unknown>).page_location, `${site}/agent?notrack=1`);
  assert.equal(JSON.stringify(calls).includes(token), false);
  assert.equal(browser['ga-disable-G-PRIVACY'], true);
});

test('analytics remain safe when rendered without a browser', () => {
  Reflect.deleteProperty(globalThis, 'window');
  assert.doesNotThrow(() => trackEvent('game_start', { game_id: 'tessel' }));
});
