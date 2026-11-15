import test from 'node:test';
import assert from 'node:assert/strict';
import { BREAK_GAMES, createBreakGameHtml, formatScore, getBreakGame, makeConfig, parseScore, variantTitle } from '../app/lib/breakGames';
import { buildPool, pickNext } from '../app/lib/distract';
import { cardPath, sharePath, shareText } from '../app/lib/share';

test('every game has a unique slug and a document whose script compiles', () => {
  assert.equal(new Set(BREAK_GAMES.map((g) => g.slug)).size, BREAK_GAMES.length);
  for (const game of BREAK_GAMES) {
    for (const seed of [1, 42, 2 ** 31 - 1]) {
      const html = createBreakGameHtml(game.slug, seed);
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      assert.equal(scripts.length, 1, game.slug);
      assert.doesNotThrow(() => new Function(scripts[0]), `${game.slug} script must parse`);
      assert.match(html, /complete/, `${game.slug} reports a score`);
      assert.match(html, /Escape/, `${game.slug} supports the hide key`);
      assert.doesNotMatch(html, /<form/, `${game.slug}: sandboxed frames have no allow-forms, so forms never submit`);
      assert.doesNotMatch(html, /<audio|AudioContext|https?:\/\/(?!www\.w3)/, `${game.slug} stays silent and offline`);
    }
  }
});

test('the same seed is the same challenge; different seeds vary', () => {
  for (const game of BREAK_GAMES) {
    assert.equal(createBreakGameHtml(game.slug, 7), createBreakGameHtml(game.slug, 7));
    assert.deepEqual(makeConfig(game.slug, 7), makeConfig(game.slug, 7));
  }
  const targets = new Set(Array.from({ length: 20 }, (_, i) => makeConfig('stop-the-clock', i).target));
  assert.ok(targets.size > 10);
});

test('seeded configs stay in playable ranges', () => {
  for (let seed = 0; seed < 300; seed++) {
    const clock = makeConfig('stop-the-clock', seed).target as number;
    assert.ok(clock >= 4 && clock < 10);
    const cuts = makeConfig('split-the-bar', seed).targets as number[];
    assert.equal(cuts.length, 5);
    assert.ok(cuts.every((t) => t >= 6 && t <= 94 && ![25, 50, 75].includes(t)));
    const order = makeConfig('number-hunt', seed).order as number[];
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
    const bpm = makeConfig('keep-the-rhythm', seed).bpm as number;
    assert.ok(bpm >= 72 && bpm <= 132);
  }
});

test('variant titles are short and literal', () => {
  assert.match(variantTitle('stop-the-clock', { target: 7.4 }), /^Stop at 7\.40 Seconds$/);
  assert.equal(variantTitle('keep-the-rhythm', { bpm: 96 }), 'Keep 96 BPM');
  for (const game of BREAK_GAMES) {
    const words = variantTitle(game.slug, makeConfig(game.slug, 3)).split(' ').length;
    assert.ok(words >= 2 && words <= 4, game.slug);
  }
});

test('scores from URLs and messages are validated per unit', () => {
  assert.equal(parseScore('%', '87.44'), 87.4);
  assert.equal(parseScore('%', '100.1'), null);
  assert.equal(parseScore('%', '-3'), null);
  assert.equal(parseScore('ms', '231.6'), 232);
  assert.equal(parseScore('pts', 350), 350);
  for (const bad of ['', 'abc', '1e5', '12<script>', null, undefined, {}]) assert.equal(parseScore('%', bad), null);
  assert.equal(formatScore('%', 87.4), '87.4%');
  assert.equal(formatScore('s', 31.25), '31.3s');
  assert.equal(getBreakGame('nope'), undefined);
});

test('share links carry only the score and campaign tags', () => {
  const daily = { kind: 'daily' as const, date: '2026-11-05', number: 2, title: 'Dot Flash' };
  assert.equal(sharePath(daily, 87.4), '/daily/2026-11-05?score=87.4&utm_source=share&utm_medium=friend');
  assert.equal(cardPath(daily, 87.4), '/daily/2026-11-05/card?score=87.4');
  assert.equal(shareText(daily, 'dot-flash', 87.4), "I got 87.4% on today's distraction (Daily #2: Dot Flash). Your turn:");
  assert.equal(sharePath({ kind: 'game', slug: 'number-hunt', title: 'Number Hunt' }, 31.2), '/games/number-hunt?score=31.2&utm_source=share&utm_medium=friend');
});

test('Distract me never repeats the previous pick', () => {
  const pool = buildPool(['abc', 'def']);
  for (const previous of pool.map((entry) => entry.id)) {
    for (let i = 0; i < 50; i++) {
      const roll = i / 50;
      assert.notEqual(pickNext(pool, previous, () => roll).id, previous);
    }
  }
  assert.equal(pickNext([{ id: 'only', kind: 'break', weight: 1 }], 'only').id, 'only');
  assert.throws(() => pickNext([], null));
});

test('Distract me pool mixes every break game with player-made games', () => {
  const pool = buildPool(['abc']);
  assert.equal(pool.filter((e) => e.kind === 'break').length, BREAK_GAMES.length);
  assert.deepEqual(pool.filter((e) => e.kind === 'community').map((e) => e.id), ['community:abc']);
  const seen = new Set(Array.from({ length: 100 }, (_, i) => pickNext(pool, null, () => i / 100).id));
  assert.equal(seen.size, pool.length, 'every entry is reachable');
});
