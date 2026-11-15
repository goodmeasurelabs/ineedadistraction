import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_EPOCH, DAILY_ROTATION, dailyChallenge, dailyNumber, isPlayableDailyDate, nextDailyAt, utcDate } from '../app/lib/daily';
import { getBreakGame } from '../app/lib/breakGames';

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

test('the daily is deterministic by date and the same for everyone', () => {
  assert.deepEqual(dailyChallenge('2026-12-01'), dailyChallenge('2026-12-01'));
  assert.equal(dailyChallenge(DAILY_EPOCH).number, 1);
  assert.equal(dailyNumber(addDays(DAILY_EPOCH, 9)), 10);
});

test('consecutive days rotate games and every rotation game is daily-capable', () => {
  for (const slug of DAILY_ROTATION) assert.equal(getBreakGame(slug)?.daily, true, slug);
  for (let i = 0; i < 60; i++) {
    const a = dailyChallenge(addDays(DAILY_EPOCH, i));
    const b = dailyChallenge(addDays(DAILY_EPOCH, i + 1));
    assert.notEqual(a.slug, b.slug);
    assert.notEqual(a.seed, b.seed);
    assert.ok(a.title.length > 3);
  }
  const week = new Set(Array.from({ length: DAILY_ROTATION.length }, (_, i) => dailyChallenge(addDays(DAILY_EPOCH, i)).slug));
  assert.equal(week.size, DAILY_ROTATION.length);
});

test('only real dates from #1 to today are playable', () => {
  const today = '2026-11-20';
  assert.ok(isPlayableDailyDate(DAILY_EPOCH, today));
  assert.ok(isPlayableDailyDate(today, today));
  assert.ok(!isPlayableDailyDate('2026-11-21', today), 'no peeking at tomorrow');
  assert.ok(!isPlayableDailyDate('2026-11-03', today), 'nothing before #1');
  for (const bad of ['2026-02-30', '2026-1-05', 'today', '2026-11-05T00:00']) assert.ok(!isPlayableDailyDate(bad, today), bad);
  assert.throws(() => dailyChallenge('nope'));
});

test('UTC day boundaries', () => {
  assert.equal(utcDate(new Date('2026-11-05T23:59:59Z')), '2026-11-05');
  assert.equal(nextDailyAt(new Date('2026-11-05T10:00:00Z')).toISOString(), '2026-11-06T00:00:00.000Z');
});
