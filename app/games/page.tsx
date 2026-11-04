import type { Metadata } from 'next';
import { GameCards, PageShell } from '../components/SiteChrome';
import { getWidgets } from '../lib/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'All games · tiny games for a break · I Need a Distraction',
  description: 'Every game on I Need a Distraction: small, named games under two minutes that each end on one score you can share. Free, no sign-up, no sound.',
  alternates: { canonical: '/games' },
};

export default async function GamesIndex() {
  const widgets = await getWidgets();
  const classics = widgets.filter((w) => w.type === 'builtin');
  const players = widgets.filter((w) => w.type === 'user-created').slice(0, 12);
  return (
    <PageShell>
      <header className="bb-page-head">
        <p className="magic-eyebrow"><span /> ALL GAMES</p>
        <h1>Tiny games, one score each.</h1>
        <p className="bb-lede">Every game here fits in a break: under two minutes, no sign-up, no sound, and it ends on a number you can share. Can’t choose? <a href="/">Press Distract me</a> or play <a href="/daily">today’s daily</a>.</p>
      </header>
      <GameCards headingLevel={2} />
      {players.length > 0 && (
        <section className="bb-prose" aria-labelledby="players-title">
          <h2 id="players-title">Made by players</h2>
          <p>Games people made with the <a href="/make-a-game">AI game maker</a>. They come up in the Distract me button too.</p>
          <ul className="bb-list">{players.map((w) => <li key={w.id}><a href={`/play/${w.id}`}>{w.emoji} {w.title}</a>{w.author ? ` · by ${w.author}` : ''}</li>)}</ul>
        </section>
      )}
      {classics.length > 0 && (
        <section className="bb-prose" aria-labelledby="classics-title">
          <h2 id="classics-title">Classics</h2>
          <p>Familiar games from our early days, still here if you want them.</p>
          <ul className="bb-list">{classics.map((w) => <li key={w.id}><a href={`/play/${w.id}`}>{w.emoji} {w.title}</a></li>)}</ul>
        </section>
      )}
    </PageShell>
  );
}
