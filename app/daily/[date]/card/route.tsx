import { formatScore, parseScore } from '@/app/lib/breakGames';
import { dailyChallenge, formatDailyDate, isPlayableDailyDate } from '@/app/lib/daily';
import { scoreCard } from '@/app/lib/scoreCard';

export async function GET(req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isPlayableDailyDate(date)) return new Response('Not found', { status: 404 });
  const daily = dailyChallenge(date);
  const score = parseScore(daily.game.unit, new URL(req.url).searchParams.get('score'));
  return scoreCard({
    eyebrow: `DAILY #${daily.number}`,
    title: `${daily.game.emoji} ${daily.title}`,
    score: score === null ? null : formatScore(daily.game.unit, score),
    caption: formatDailyDate(date),
    accent: daily.game.accent,
  });
}
