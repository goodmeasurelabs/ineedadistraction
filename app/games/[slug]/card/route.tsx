import { formatScore, getBreakGame, parseScore } from '@/app/lib/breakGames';
import { scoreCard } from '@/app/lib/scoreCard';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = getBreakGame(slug);
  if (!game) return new Response('Not found', { status: 404 });
  const score = parseScore(game.unit, new URL(req.url).searchParams.get('score'));
  return scoreCard({
    eyebrow: game.roundLabel.toUpperCase(),
    title: `${game.emoji} ${game.name}`,
    score: score === null ? null : formatScore(game.unit, score),
    caption: game.tagline.length > 60 ? `${game.tagline.slice(0, 57)}…` : game.tagline,
    accent: game.accent,
  });
}
