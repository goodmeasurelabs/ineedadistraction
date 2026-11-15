'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GAMES } from './registry';
import { trackContentEngagement } from '../lib/analytics';
import './shelf.css';

// The first-party arcade: four games, each one click from playing. Personal
// bests and an unfinished run are read from this device so returning players
// see their own numbers, not a generic card.
export default function GameShelf({ location = 'home' }: { location?: string }) {
  const [local, setLocal] = useState<Record<string, { best: number; resume: boolean }>>({});
  useEffect(() => {
    const next: Record<string, { best: number; resume: boolean }> = {};
    try {
      for (const game of GAMES) {
        next[game.slug] = { best: Number(localStorage.getItem(`inad:best:${game.slug}`)) || 0, resume: !!localStorage.getItem(`inad:save:${game.slug}:endless`) };
      }
    } catch { /* storage is optional */ }
    setLocal(next);
  }, []);

  return (
    <div className="shelf">
      {GAMES.map((game, index) => {
        const mine = local[game.slug];
        return (
          <Link
            key={game.slug} href={`/games/${game.slug}`} className="shelf-card" prefetch={index < 2}
            style={{ '--accent': game.accent, '--art-a': game.art[0], '--art-b': game.art[1] } as React.CSSProperties}
            onClick={() => trackContentEngagement({ content_type: 'first_party_game', content_id: `${game.slug}:${location}`, engagement_type: 'interaction' })}
          >
            <div className="shelf-art">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/shelf/${game.slug}.jpg`} alt="" loading={index < 2 ? 'eager' : 'lazy'} onError={(event) => { event.currentTarget.style.display = 'none'; }} />
              <span className="shelf-glyph" aria-hidden="true">{game.emoji}</span>
              <span className="shelf-pace">{game.pace}</span>
              <span className="shelf-play" aria-hidden="true">{mine?.resume ? 'Resume ▶' : 'Play ▶'}</span>
            </div>
            <div className="shelf-body">
              <h3>{game.title}</h3>
              <p>{game.tagline}</p>
              <small>{mine?.best ? `Your best ${mine.best.toLocaleString()}` : 'No score yet. Set one.'}</small>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
