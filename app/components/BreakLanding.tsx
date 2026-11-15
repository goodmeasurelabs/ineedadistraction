import LandingPlayer from './LandingPlayer';
import { GameCards, PageShell } from './SiteChrome';
import { getBreakGame, hashString, type BreakGame } from '../lib/breakGames';
import { utcDate } from '../lib/daily';
import { SITE_URL } from '../lib/share';

export type LandingConfig = {
  path: string;
  eyebrow: string;
  title: string;
  intro: string;
  mode: 'class' | 'work' | 'quick';
  slugs: string[];
  points: string[];
  faq: { q: string; a: string }[];
  gameNote: (game: BreakGame) => string;
};

export default function BreakLanding({ config }: { config: LandingConfig }) {
  const games = config.slugs.map((slug) => getBreakGame(slug)).filter((g): g is BreakGame => !!g);
  const itemList = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: config.title,
    itemListElement: games.map((game, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_URL}/games/${game.slug}`, name: game.name })),
  };
  const faq = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: config.faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  return (
    <PageShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json(itemList) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json(faq) }} />
      <header className="bb-page-head">
        <p className="magic-eyebrow"><span /> {config.eyebrow}</p>
        <h1>{config.title}</h1>
        <p className="bb-lede">{config.intro}</p>
        <ul className="bb-points">{config.points.map((point) => <li key={point}>{point}</li>)}</ul>
      </header>
      <LandingPlayer slugs={config.slugs} initialSeed={hashString(`${config.path}:${utcDate()}`)} mode={config.mode} />
      <section className="bb-section" aria-labelledby="list-title">
        <h2 id="list-title" className="bb-h2">The games</h2>
        <GameCards games={games} note={config.gameNote} />
      </section>
      <section className="bb-prose" aria-labelledby="faq-title">
        <h2 id="faq-title">Questions</h2>
        {config.faq.map(({ q, a }) => <div key={q}><h3>{q}</h3><p>{a}</p></div>)}
        <p>Want something different every time? <a href="/">Press Distract me</a>, or try <a href="/daily">today’s daily challenge</a>.</p>
      </section>
    </PageShell>
  );
}
