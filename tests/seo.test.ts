import test from 'node:test';
import assert from 'node:assert/strict';
import { STATIC_PATHS } from '../app/lib/siteMap';
import { buildLlmsTxt } from '../app/lib/llms';
import { BREAK_GAMES } from '../app/lib/breakGames';
import { AT_WORK, BRAIN_BREAK, FIVE_MINUTE } from '../app/lib/landings';

test('sitemap lists every named game page, the daily and the landing pages', () => {
  for (const path of ['/', '/daily', '/games', '/brain-break-games', '/games-to-play-at-work', '/5-minute-games', '/make-a-game']) assert.ok(STATIC_PATHS.includes(path), path);
  for (const game of BREAK_GAMES) assert.ok(STATIC_PATHS.includes(`/games/${game.slug}`), game.slug);
  assert.equal(new Set(STATIC_PATHS).size, STATIC_PATHS.length);
});

test('llms.txt names the button, the daily and every game', () => {
  const text = buildLlmsTxt('2026-11-10');
  assert.match(text, /^# I Need a Distraction\n\n> /);
  assert.match(text, /Daily #7:/);
  for (const game of BREAK_GAMES) assert.ok(text.includes(`/games/${game.slug}`), game.slug);
  for (const page of [BRAIN_BREAK, AT_WORK, FIVE_MINUTE]) assert.ok(text.includes(page.path));
});

test('landing pages reuse real games and answer four audience questions', () => {
  for (const page of [BRAIN_BREAK, AT_WORK, FIVE_MINUTE]) {
    assert.equal(page.faq.length, 4, page.path);
    assert.ok(page.slugs.length >= 6 && page.slugs.length <= 10, page.path);
    for (const slug of page.slugs) assert.ok(BREAK_GAMES.some((g) => g.slug === slug), slug);
    const words = page.intro.split(/\s+/).length;
    assert.ok(words >= 30 && words <= 50, `${page.path} intro is ${words} words`);
  }
});
