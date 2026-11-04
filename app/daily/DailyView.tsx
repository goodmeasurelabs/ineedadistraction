import type { Metadata } from 'next';
import DailyPlayer from '../components/DailyPlayer';
import { PageShell } from '../components/SiteChrome';
import { formatScore, parseScore } from '../lib/breakGames';
import { DAILY_EPOCH, dailyChallenge, formatDailyDate, nextDailyAt, utcDate } from '../lib/daily';

export function dailyMetadata(date: string, rawScore: string | undefined, isArchive: boolean): Metadata {
  const daily = dailyChallenge(date);
  const score = parseScore(daily.game.unit, rawScore);
  const title = score !== null
    ? `${formatScore(daily.game.unit, score)} on Daily #${daily.number}: ${daily.title}. Your turn.`
    : `Daily #${daily.number}: ${daily.title} · today's 2-minute challenge`;
  const description = `One tiny scored game, the same for everyone today. ${daily.game.tagline} No sign-up. Share your score.`;
  const image = `/daily/${date}/card${score !== null ? `?score=${score}` : ''}`;
  return {
    title,
    description,
    alternates: { canonical: isArchive ? `/daily/${date}` : '/daily' },
    robots: isArchive ? { index: false, follow: true } : undefined,
    openGraph: { title, description, images: [image], url: isArchive ? `/daily/${date}` : '/daily', siteName: 'I Need a Distraction', type: 'website' },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default function DailyView({ date, rawScore }: { date: string; rawScore?: string }) {
  const today = utcDate();
  const daily = dailyChallenge(date);
  const isToday = date === today;
  const yesterday = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const structured = {
    '@context': 'https://schema.org', '@type': 'VideoGame', name: `Daily #${daily.number}: ${daily.title}`,
    description: daily.game.description, url: `https://www.ineedadistraction.com/daily/${date}`,
    gamePlatform: 'Web browser', applicationCategory: 'Game', isAccessibleForFree: true, datePublished: date,
  };
  return (
    <PageShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, '\\u003c') }} />
      <header className="bb-page-head">
        <p className="magic-eyebrow"><span /> {isToday ? 'TODAY’S DAILY' : 'FROM THE ARCHIVE'} · #{daily.number} · {formatDailyDate(date).toUpperCase()}</p>
        <h1>{daily.title}</h1>
        <p className="bb-lede">{daily.game.tagline} Same challenge for everyone {isToday ? 'today' : 'that day'}. {daily.game.roundLabel}, one score, no sign-up.</p>
      </header>
      <DailyPlayer date={date} number={daily.number} slug={daily.slug} seed={daily.seed} title={daily.title} unit={daily.game.unit}
        isToday={isToday} friendScore={parseScore(daily.game.unit, rawScore)} nextAt={nextDailyAt().getTime()} />
      <section className="bb-prose" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol>{daily.game.howTo.map((step) => <li key={step}>{step}</li>)}</ol>
        <p>A new challenge starts every day at midnight UTC. Each one is a fresh variant of one of our games, built from the date, so everyone plays exactly the same thing. Like this kind of game? <a href={`/games/${daily.slug}`}>Play {daily.game.name} any time</a>.</p>
        <p className="bb-archive-links">
          {date > DAILY_EPOCH && <a href={`/daily/${yesterday}`}>← Previous daily</a>}
          {!isToday && <a href="/daily">Today’s daily →</a>}
        </p>
      </section>
    </PageShell>
  );
}
