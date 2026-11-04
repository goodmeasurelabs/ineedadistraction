import type { ReactNode } from 'react';
import { BREAK_GAMES, type BreakGame } from '../lib/breakGames';

export function SiteHeader() {
  return (
    <header className="distraction-header">
      <div className="distraction-nav">
        <a className="distraction-brand" href="/" aria-label="I Need a Distraction home"><span className="brand-symbol" aria-hidden="true">✳</span><span>i need a<br /><strong>distraction.</strong></span></a>
        <nav aria-label="Main navigation" className="bb-nav">
          <a href="/daily">Daily</a>
          <a href="/games">All games</a>
          <a href="/make-a-game" className="bb-nav-hide-sm">Make a game</a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="distraction-footer bb-footer">
      <span>The break button: a tiny game, then back to work.</span>
      <nav aria-label="Footer">
        <a href="/daily">Daily challenge</a>
        <a href="/games">All games</a>
        <a href="/brain-break-games">Brain break games</a>
        <a href="/games-to-play-at-work">Games to play at work</a>
        <a href="/5-minute-games">5-minute games</a>
        <a href="/make-a-game">AI game maker</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <span>© {new Date().getFullYear()} I Need a Distraction</span>
      </nav>
    </footer>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="distraction-home">
      <SiteHeader />
      <main className="distraction-main bb-page">{children}</main>
      <div className="distraction-main"><SiteFooter /></div>
    </div>
  );
}

export function GameCards({ games = BREAK_GAMES, headingLevel = 3, note }: { games?: BreakGame[]; headingLevel?: 2 | 3; note?: (game: BreakGame) => string }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <ul className="bb-cards">
      {games.map((game) => (
        <li key={game.slug} style={{ '--card-accent': game.accent } as React.CSSProperties}>
          <a href={`/games/${game.slug}`}>
            <span className="bb-card-emoji" aria-hidden="true">{game.emoji}</span>
            <Heading>{game.name}</Heading>
            <p>{game.tagline}</p>
            <small>{note ? note(game) : `${game.roundLabel} · scored in ${game.scoreLabel}`}</small>
          </a>
        </li>
      ))}
    </ul>
  );
}
