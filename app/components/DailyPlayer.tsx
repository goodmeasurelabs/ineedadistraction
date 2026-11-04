'use client';

import { useEffect, useState } from 'react';
import GameStage from './GameStage';
import { formatScore, type ScoreUnit } from '../lib/breakGames';

const RESULTS_KEY = 'inad-daily-results';

function readResults(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RESULTS_KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, number> : {};
  } catch { return {}; }
}

function streakEnding(results: Record<string, number>, date: string): number {
  let streak = 0;
  let day = Date.parse(`${date}T00:00:00Z`);
  while (typeof results[new Date(day).toISOString().slice(0, 10)] === 'number') { streak++; day -= 86_400_000; }
  return streak;
}

function untilNext(nextAt: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((nextAt - now) / 60_000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function DailyPlayer({ date, number, slug, seed, title, unit, isToday, friendScore, nextAt }: {
  date: string; number: number; slug: string; seed: number; title: string; unit: ScoreUnit;
  isToday: boolean; friendScore: number | null; nextAt: number;
}) {
  const [first, setFirst] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const results = readResults();
    setFirst(typeof results[date] === 'number' ? results[date] : null);
    setStreak(streakEnding(results, date));
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [date]);

  function onComplete(score: number) {
    const results = readResults();
    if (typeof results[date] !== 'number') {
      results[date] = score;
      try { localStorage.setItem(RESULTS_KEY, JSON.stringify(results)); } catch { /* Scores still show without storage. */ }
      setFirst(score);
      setStreak(streakEnding(results, date));
    }
  }

  return (
    <div className="bb-daily-player">
      {friendScore !== null && <p className="bb-challenge">A friend got <strong>{formatScore(unit, friendScore)}</strong> on this one. Your turn.</p>}
      <GameStage slug={slug} seed={seed} location="daily" dailyNumber={number} onComplete={onComplete} share={{ kind: 'daily', date, number, title }} label={`Play Daily #${number}: ${title}`} />
      <dl className="bb-daily-stats">
        <div><dt>Your first score</dt><dd>{first === null ? '—' : formatScore(unit, first)}</dd></div>
        <div><dt>Daily streak on this device</dt><dd>{streak} {streak === 1 ? 'day' : 'days'}</dd></div>
        {isToday && <div><dt>Next challenge in</dt><dd>{now === null ? '—' : untilNext(nextAt, now)}</dd></div>}
      </dl>
      <p className="bb-fineprint">Your first score of the day counts. Replays are practice. Scores stay in this browser; there is no account and no leaderboard.</p>
    </div>
  );
}
