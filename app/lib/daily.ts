// The daily challenge: one named, scored game per UTC day, the same for
// everyone. Everything is derived from the date string, so there is no
// server state, no cron and no AI call behind it.
import { BREAK_GAMES, hashString, makeConfig, variantTitle, type BreakGame } from './breakGames';

export const DAILY_EPOCH = '2026-11-04'; // Daily #1
const DAY_MS = 86_400_000;

// Rotation order: alternate kinds of skill so consecutive days feel different.
export const DAILY_ROTATION = ['stop-the-clock', 'dot-flash', 'number-hunt', 'color-recall', 'split-the-bar', 'keep-the-rhythm'];

export type DailyChallenge = {
  date: string;
  number: number;
  slug: string;
  seed: number;
  title: string;
  game: BreakGame;
};

export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function dayValue(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = dayValue(value);
  return Number.isFinite(parsed) && utcDate(new Date(parsed)) === value;
}

// A playable daily date: well-formed, not before #1 and not after today (UTC).
export function isPlayableDailyDate(date: string, today: string = utcDate()): boolean {
  return isDateString(date) && date >= DAILY_EPOCH && date <= today;
}

export function dailyNumber(date: string): number {
  return Math.round((dayValue(date) - dayValue(DAILY_EPOCH)) / DAY_MS) + 1;
}

export function dailyChallenge(date: string): DailyChallenge {
  if (!isDateString(date)) throw new Error(`Invalid daily date: ${date}`);
  const number = dailyNumber(date);
  const slug = DAILY_ROTATION[(((number - 1) % DAILY_ROTATION.length) + DAILY_ROTATION.length) % DAILY_ROTATION.length];
  const seed = hashString(`inad-daily:${date}`);
  const game = BREAK_GAMES.find((g) => g.slug === slug) as BreakGame;
  return { date, number, slug, seed, title: variantTitle(slug, makeConfig(slug, seed)), game };
}

export function nextDailyAt(now: Date = new Date()): Date {
  return new Date(dayValue(utcDate(now)) + DAY_MS);
}

export function formatDailyDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
