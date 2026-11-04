import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import GamePlayer from '../../components/GamePlayer';
import { GameCards, PageShell } from '../../components/SiteChrome';
import { BREAK_GAMES, formatScore, getBreakGame, hashString, parseScore } from '../../lib/breakGames';
import { utcDate } from '../../lib/daily';

export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;
type Search = Promise<{ score?: string }>;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { slug } = await params;
  const game = getBreakGame(slug);
  if (!game) return { title: 'Game not found · I Need a Distraction', robots: { index: false, follow: false } };
  const score = parseScore(game.unit, (await searchParams).score);
  const title = score !== null ? `${formatScore(game.unit, score)} on ${game.name}. Your turn.` : `${game.name} · a tiny free game, no sign-up · I Need a Distraction`;
  const image = `/games/${slug}/card${score !== null ? `?score=${score}` : ''}`;
  return {
    title,
    description: `${game.tagline} ${game.roundLabel}, free, no sign-up, no sound. Ends on one score you can share.`,
    alternates: { canonical: `/games/${slug}` },
    openGraph: { title, description: game.tagline, images: [image], url: `/games/${slug}`, siteName: 'I Need a Distraction', type: 'website' },
    twitter: { card: 'summary_large_image', title, description: game.tagline, images: [image] },
  };
}

export default async function GamePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const game = getBreakGame(slug);
  if (!game) notFound();
  const friendScore = parseScore(game.unit, (await searchParams).score);
  const structured = {
    '@context': 'https://schema.org', '@type': 'VideoGame', name: game.name, description: game.description,
    url: `https://www.ineedadistraction.com/games/${slug}`, gamePlatform: 'Web browser', applicationCategory: 'Game', isAccessibleForFree: true,
  };
  return (
    <PageShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, '\\u003c') }} />
      <header className="bb-page-head">
        <p className="magic-eyebrow"><span /> {game.roundLabel.toUpperCase()} · SCORED IN {game.scoreLabel.toUpperCase()}</p>
        <h1><span aria-hidden="true">{game.emoji}</span> {game.name}</h1>
        <p className="bb-lede">{game.tagline}</p>
      </header>
      <GamePlayer slug={slug} name={game.name} initialSeed={hashString(`${slug}:${utcDate()}`)} unit={game.unit} friendScore={friendScore} />
      <section className="bb-prose" aria-labelledby="about-title">
        <h2 id="about-title">About {game.name}</h2>
        <p>{game.description}</p>
        <h3>How to play</h3>
        <ol>{game.howTo.map((step) => <li key={step}>{step}</li>)}</ol>
        <h3>Your score</h3>
        <p>{game.better === 'higher' ? 'Higher is better.' : 'Lower is better.'} Scores are measured in {game.scoreLabel} and stay in your browser. Share one and your friend lands on this page with your number to beat.</p>
        <h3>In a classroom or a meeting</h3>
        <p>{game.classroom} Everything is silent and works on a projector. See <a href="/brain-break-games">brain break games</a> and <a href="/games-to-play-at-work">games to play at work</a>.</p>
      </section>
      <section className="bb-section" aria-labelledby="more-title">
        <h2 id="more-title" className="bb-h2">More tiny games</h2>
        <GameCards games={BREAK_GAMES.filter((g) => g.slug !== slug)} />
      </section>
    </PageShell>
  );
}
